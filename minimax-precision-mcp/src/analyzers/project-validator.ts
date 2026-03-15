import * as fs from "fs";
import * as path from "path";
import { ProjectFinding, ValidateProjectResult } from "../types.js";

/**
 * ProjectValidator: detects cross-module wiring issues that file-level analysis cannot find.
 *
 * Key patterns detected:
 * - Entire module directories with public items that are never imported in the entry point
 * - Coordinator/Manager structs that exist but are never instantiated from main
 * - Trait implementations that reference methods not declared on the trait
 * - Node.js modules that are never imported from the entry index
 */
export class ProjectValidator {
  validateProject(projectPath: string): ValidateProjectResult {
    const absPath = path.resolve(projectPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Project path does not exist: ${absPath}`);
    }

    const language = this.detectProjectLanguage(absPath);

    if (language === "rust") {
      return this.validateRustProject(absPath);
    } else if (language === "typescript" || language === "javascript") {
      return this.validateNodeProject(absPath, language);
    } else if (language === "go") {
      return this.validateGoProject(absPath);
    }

    return {
      passed: true,
      path: absPath,
      language: language ?? "unknown",
      entry_point: null,
      modules_found: 0,
      modules_connected: 0,
      modules_dead: 0,
      total_issues: 0,
      blockers: [],
      warnings: [],
      dead_modules: [],
      verdict: `⚠️ Language '${language}' not fully supported for project-level validation`,
    };
  }

  // ── Language detection ────────────────────────────────────────────────────

  private detectProjectLanguage(projectPath: string): string | null {
    if (fs.existsSync(path.join(projectPath, "Cargo.toml"))) return "rust";
    if (fs.existsSync(path.join(projectPath, "package.json"))) {
      if (fs.existsSync(path.join(projectPath, "tsconfig.json"))) return "typescript";
      return "javascript";
    }
    if (fs.existsSync(path.join(projectPath, "go.mod"))) return "go";
    if (
      fs.existsSync(path.join(projectPath, "setup.py")) ||
      fs.existsSync(path.join(projectPath, "pyproject.toml"))
    )
      return "python";
    return null;
  }

  // ── Rust ──────────────────────────────────────────────────────────────────

  private validateRustProject(projectPath: string): ValidateProjectResult {
    const findings: ProjectFinding[] = [];

    // Locate entry point
    const mainRs = path.join(projectPath, "src", "main.rs");
    const libRs = path.join(projectPath, "src", "lib.rs");
    const entryPath = fs.existsSync(mainRs)
      ? mainRs
      : fs.existsSync(libRs)
      ? libRs
      : null;

    if (!entryPath) {
      return this.buildResult(projectPath, "rust", null, 0, 0, 0, [], [
        {
          category: "missing_entry",
          severity: "critical",
          location: path.join(projectPath, "src"),
          message:
            "No entry point found: neither src/main.rs nor src/lib.rs exists",
          suggestion: "Create src/main.rs with a main() function",
        },
      ]);
    }

    const entryContent = fs.readFileSync(entryPath, "utf-8");

    // When both main.rs and lib.rs exist, lib.rs is the module registry.
    // main.rs typically uses `use <crate>::module::Type` (external path),
    // NOT `mod module;` — so we must also scan lib.rs for module declarations.
    const libRsPath = path.join(projectPath, "src", "lib.rs");
    const libContent =
      entryPath !== libRsPath && fs.existsSync(libRsPath)
        ? fs.readFileSync(libRsPath, "utf-8")
        : "";

    // Combined "wiring scope": module names declared in EITHER entry file
    const wiringScope = entryContent + "\n" + libContent;

    // Collect all potential module names from two sources:
    // 1. `mod xxx;` declarations in the entry file OR lib.rs
    // 2. Subdirectories in src/ that contain mod.rs
    const declaredMods = this.extractRustModDeclarations(wiringScope);
    const srcDir = path.join(projectPath, "src");
    let allDirs: string[] = [];
    try {
      allDirs = fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      // ignore unreadable src/
    }

    const allModuleNames = new Set<string>([...declaredMods, ...allDirs]);
    let modulesConnected = 0;
    let modulesDead = 0;
    const deadModulesList: string[] = [];

    for (const modName of allModuleNames) {
      // Find the module's representative file
      const candidates = [
        path.join(srcDir, modName, "mod.rs"),
        path.join(srcDir, `${modName}.rs`),
      ];
      const modFilePath = candidates.find((p) => fs.existsSync(p));
      if (!modFilePath) continue;

      let modContent: string;
      try {
        modContent = fs.readFileSync(modFilePath, "utf-8");
      } catch {
        continue;
      }

      const publicItems = this.extractRustPublicItems(modContent);
      if (publicItems.length === 0) continue; // trivial module, skip

      // A module is "connected" if: it's declared in lib.rs or main.rs AND
      // at least one public item appears anywhere in the wiring scope
      // (covers both `use crate::mod::Type` and `use crate_name::mod::Type` patterns)
      const isDeclared =
        wiringScope.includes(`mod ${modName}`) ||
        wiringScope.includes(`use ${modName}`) ||
        wiringScope.includes(`use crate::${modName}`);

      const usedItems = publicItems.filter(
        (item) =>
          wiringScope.includes(item) ||
          wiringScope.includes(`${modName}::${item}`)
      );

      if (!isDeclared || usedItems.length === 0) {
        modulesDead++;
        deadModulesList.push(modName);
        const severity: "error" | "warning" =
          publicItems.length > 3 ? "error" : "warning";
        findings.push({
          category: "dead_module",
          severity,
          location: modFilePath,
          message: `Module '${modName}' has ${publicItems.length} public items but none are imported or used in ${path.basename(entryPath)}`,
          suggestion: `Add 'mod ${modName};' and use its types in ${path.basename(
            entryPath
          )} to connect the module to the execution path`,
        });
      } else {
        modulesConnected++;
      }
    }

    // Coordinator pattern: if a Coordinator struct is defined anywhere, it must be instantiated in main
    // Pass wiringScope (main.rs + lib.rs) so external-path calls like `nooov::Coordinator::new()` are found
    const coordinatorFindings = this.checkRustCoordinatorPattern(
      srcDir,
      entryPath,
      wiringScope
    );
    findings.push(...coordinatorFindings);

    // Trait method mismatch: find traits and check impl blocks call only declared methods
    const traitFindings = this.checkRustTraitMethodCalls(srcDir);
    findings.push(...traitFindings);

    // Zero tests check: if no #[test] exists anywhere in src/, it's a blocker
    const testFindings = this.checkRustTestCoverage(srcDir);
    findings.push(...testFindings);

    // Empty module files: .rs files with < 3 real lines of code
    const emptyModFindings = this.checkRustEmptyModules(srcDir);
    findings.push(...emptyModFindings);

    // Integration test coverage: Coordinator defined but tests never call it
    const integrationFindings = this.checkRustIntegrationTestCoverage(srcDir, projectPath);
    findings.push(...integrationFindings);

    return this.buildResult(
      projectPath,
      "rust",
      entryPath,
      allModuleNames.size,
      modulesConnected,
      modulesDead,
      deadModulesList,
      findings
    );
  }

  /** Extract `mod xxx;` names from Rust source */
  private extractRustModDeclarations(content: string): string[] {
    const matches: string[] = [];
    const re = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      matches.push(m[1]);
    }
    return matches;
  }

  /** Extract names of public items (structs, fns, enums, traits) from Rust source */
  private extractRustPublicItems(content: string): string[] {
    const items: string[] = [];
    // pub struct/enum/trait/fn Foo
    const re =
      /^\s*pub\s+(?:async\s+)?(?:struct|enum|trait|fn|type)\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      items.push(m[1]);
    }
    // pub use ... re-exports: grab the last segment
    const reUse = /^\s*pub\s+use\s+[^;]+::(\w+)\s*;/gm;
    while ((m = reUse.exec(content)) !== null) {
      items.push(m[1]);
    }
    return [...new Set(items)];
  }

  /**
   * Detects the anti-pattern: an orchestrator struct (Coordinator, Pipeline,
   * Manager, Orchestrator, Workflow, Runner, Engine) is defined but never
   * instantiated from the entry file.
   *
   * Covers naming conventions beyond just "Coordinator" — projects use
   * Pipeline, WorkflowManager, AgentOrchestrator, etc.
   */
  private checkRustCoordinatorPattern(
    srcDir: string,
    entryPath: string,
    wiringScope: string
  ): ProjectFinding[] {
    const findings: ProjectFinding[] = [];

    // Common orchestrator naming patterns — struct names that imply "main driver"
    const orchestratorNamePattern =
      /pub\s+struct\s+((?:\w*(?:Coordinator|Pipeline|Orchestrator|Workflow|Runner|Engine)\w*|(?:App|Main)Manager))\b/;

    const rsFiles = this.walkRsFiles(srcDir);
    for (const fp of rsFiles) {
      let content: string;
      try {
        content = fs.readFileSync(fp, "utf-8");
      } catch {
        continue;
      }

      const nameMatch = orchestratorNamePattern.exec(content);
      if (!nameMatch) continue;

      const structName = nameMatch[1];

      // Check if ::new() or struct literal initialisation appears in wiring scope
      const isInstantiated =
        wiringScope.includes(`${structName}::new(`) ||
        wiringScope.includes(`${structName} {`);

      if (!isInstantiated) {
        findings.push({
          category: "disconnected_subsystem",
          severity: "error",
          location: fp,
          message: `'${structName}' struct is defined in '${path.relative(
            srcDir,
            fp
          )}' but ${structName}::new() is never called in ${path.basename(entryPath)}`,
          suggestion: `Instantiate ${structName} in ${path.basename(
            entryPath
          )} and call its run()/execute() method to drive the workflow`,
        });
        break; // one report per project is enough
      }
    }

    return findings;
  }

  /**
   * Checks for trait method calls (e.g., self.llm.chat()) that don't match
   * any method declared on the trait. Scans all impl blocks.
   */
  private checkRustTraitMethodCalls(srcDir: string): ProjectFinding[] {
    const findings: ProjectFinding[] = [];

    // Find trait definitions: collect trait name → set of declared method names
    const traitMethods = new Map<string, Set<string>>();
    const traitDefRegex =
      /pub\s+trait\s+(\w+)[^{]*\{([\s\S]*?)^\}/gm;
    const methodDeclRegex = /(?:async\s+)?fn\s+(\w+)\s*\(/g;

    const rsFiles = this.walkRsFiles(srcDir);
    for (const fp of rsFiles) {
      let content: string;
      try {
        content = fs.readFileSync(fp, "utf-8");
      } catch {
        continue;
      }

      let tMatch: RegExpExecArray | null;
      while ((tMatch = traitDefRegex.exec(content)) !== null) {
        const traitName = tMatch[1];
        const body = tMatch[2];
        const methods = new Set<string>();
        let mMatch: RegExpExecArray | null;
        while ((mMatch = methodDeclRegex.exec(body)) !== null) {
          methods.add(mMatch[1]);
        }
        if (methods.size > 0) {
          traitMethods.set(traitName, methods);
        }
      }
    }

    if (traitMethods.size === 0) return findings;

    // For each impl block, find self.xxx() calls and check against trait methods
    const implBlockRegex =
      /impl\s+(\w+)\s+for\s+\w+[^{]*\{([\s\S]*?)^\}/gm;
    const selfCallRegex = /self\.(\w+)\s*\(/g;

    for (const fp of rsFiles) {
      let content: string;
      try {
        content = fs.readFileSync(fp, "utf-8");
      } catch {
        continue;
      }

      let iMatch: RegExpExecArray | null;
      while ((iMatch = implBlockRegex.exec(content)) !== null) {
        const traitName = iMatch[1];
        const implBody = iMatch[2];
        const declared = traitMethods.get(traitName);
        if (!declared) continue;

        let callMatch: RegExpExecArray | null;
        while ((callMatch = selfCallRegex.exec(implBody)) !== null) {
          const calledMethod = callMatch[1];
          // Skip common Rust idioms (clone, to_string, into, etc.)
          const rustBuiltins = new Set([
            "clone", "to_string", "into", "from", "as_str", "as_ref",
            "unwrap", "expect", "ok", "err", "map", "and_then", "push",
            "len", "is_empty", "iter", "collect",
          ]);
          if (!rustBuiltins.has(calledMethod) && !declared.has(calledMethod)) {
            findings.push({
              category: "trait_mismatch",
              severity: "error",
              location: `${fp}`,
              message: `impl ${traitName}: calls self.${calledMethod}() but trait '${traitName}' does not declare a method named '${calledMethod}'`,
              suggestion: `Either add 'async fn ${calledMethod}(...)' to the ${traitName} trait definition, or fix the call to use a method that exists on the trait`,
            });
          }
        }
      }
    }

    return findings;
  }

  /**
   * Checks that the Rust project has at least one #[test] function.
   * "cargo test" showing "running 0 tests" is a failure — this gate enforces that.
   * Only flags as a blocker when there are substantial modules (>2 src subdirs),
   * to avoid false positives on trivially small library crates.
   */
  private checkRustTestCoverage(srcDir: string): ProjectFinding[] {
    const rsFiles = this.walkRsFiles(srcDir);
    const hasAnyTest = rsFiles.some(fp => {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        return content.includes('#[test]') || content.includes('#[cfg(test)]');
      } catch {
        return false;
      }
    });

    if (hasAnyTest) return [];

    // Count substantive source files (excluding mod.rs / lib.rs / main.rs)
    const substantiveFiles = rsFiles.filter(fp => {
      const base = path.basename(fp);
      return base !== 'main.rs' && base !== 'lib.rs' && base !== 'mod.rs';
    });

    // Only flag as a blocker if the project is non-trivial (has real modules)
    const severity: 'critical' | 'warning' = substantiveFiles.length >= 2 ? 'critical' : 'warning';

    return [{
      category: 'missing_tests',
      severity,
      location: srcDir,
      message: `No tests found in project (${rsFiles.length} .rs files, 0 #[test] functions) — "cargo test" will show "running 0 tests"`,
      suggestion: 'Add at least one integration test that calls the main workflow end-to-end with a mock dependency. Unit tests alone are insufficient — there must be a test that exercises the full execution path.'
    }];
  }

  /**
   * Detects .rs files that are effectively empty placeholders:
   * < 3 real lines of code (non-blank, non-comment-only).
   * These are "ghost module" files — declared in mod.rs but containing nothing.
   */
  private checkRustEmptyModules(srcDir: string): ProjectFinding[] {
    const findings: ProjectFinding[] = [];
    const rsFiles = this.walkRsFiles(srcDir);

    for (const fp of rsFiles) {
      const base = path.basename(fp);
      // Skip conventional entry/aggregator files — their job may legitimately be just declarations
      if (base === 'main.rs' || base === 'lib.rs' || base === 'mod.rs') continue;

      let content: string;
      try {
        content = fs.readFileSync(fp, 'utf-8');
      } catch {
        continue;
      }

      // Count lines that carry real code (skip blank lines and comment-only lines)
      const realLines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return (
          trimmed.length > 0 &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('/*') &&
          !trimmed.startsWith('*') &&
          !trimmed.startsWith('#') // attribute macros are not logic
        );
      });

      if (realLines.length < 3) {
        findings.push({
          category: 'dead_module',
          severity: 'error',
          location: fp,
          message: `File '${path.relative(srcDir, fp)}' has only ${realLines.length} real line(s) — it is an empty placeholder module with no implementation`,
          suggestion: `Either implement the module's intended logic or delete the file and remove its 'mod ${path.basename(fp, '.rs')};' declaration`
        });
      }
    }

    return findings;
  }

  /**
   * If a Coordinator struct is defined AND tests exist, but no test ever
   * calls Coordinator::new() or coordinator.run(), the main workflow is
   * never exercised — report a warning.
   */
  private checkRustIntegrationTestCoverage(srcDir: string, projectPath: string): ProjectFinding[] {
    const rsFiles = this.walkRsFiles(srcDir);

    // Only applies when a Coordinator struct exists
    const hasCoordinator = rsFiles.some(fp => {
      try {
        return /pub\s+struct\s+Coordinator\b/.test(fs.readFileSync(fp, 'utf-8'));
      } catch { return false; }
    });
    if (!hasCoordinator) return [];

    // Collect all .rs content that lives under a test context:
    // - files in tests/ directory
    // - inline #[cfg(test)] blocks in src/ files
    const testsDir = path.join(projectPath, 'tests');
    const testFilePaths: string[] = [];
    if (fs.existsSync(testsDir)) {
      try {
        fs.readdirSync(testsDir, { withFileTypes: true })
          .filter(e => e.isFile() && e.name.endsWith('.rs'))
          .forEach(e => testFilePaths.push(path.join(testsDir, e.name)));
      } catch { /* ignore */ }
    }
    rsFiles.forEach(fp => testFilePaths.push(fp)); // also covers inline tests

    const allTestContent = testFilePaths.map(fp => {
      try { return fs.readFileSync(fp, 'utf-8'); } catch { return ''; }
    }).join('\n');

    // If no tests exist at all, checkRustTestCoverage already handles it
    if (!allTestContent.includes('#[test]')) return [];

    // Tests exist — check whether any of them exercises the Coordinator
    const coordinatorCalledInTests =
      /Coordinator\s*::\s*new\s*\(/.test(allTestContent) ||
      /coordinator\s*\.\s*run\s*\(/.test(allTestContent) ||
      /coordinator\s*\.\s*execute\s*\(/.test(allTestContent);

    if (!coordinatorCalledInTests) {
      return [{
        category: 'disconnected_subsystem',
        severity: 'warning',
        location: srcDir,
        message: 'Tests exist but none call Coordinator::new() or coordinator.run() — the main multi-agent workflow is never exercised end-to-end',
        suggestion: 'Add at least one integration test that instantiates Coordinator with mock LLM agents and calls run(project) to verify the full workflow produces meaningful output'
      }];
    }

    return [];
  }

  /** Recursively collect all .rs files under a directory (depth-limited) */
  private walkRsFiles(dir: string, depth: number = 0): string[] {
    const MAX_DEPTH = 10;
    if (depth > MAX_DEPTH) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.walkRsFiles(full, depth + 1));
      } else if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(full);
      }
    }
    return files;
  }

  // ── TypeScript / JavaScript ───────────────────────────────────────────────

  private validateNodeProject(
    projectPath: string,
    language: string
  ): ValidateProjectResult {
    const findings: ProjectFinding[] = [];

    // Find entry point
    const entryPaths = [
      path.join(projectPath, "src", "index.ts"),
      path.join(projectPath, "src", "main.ts"),
      path.join(projectPath, "src", "index.js"),
      path.join(projectPath, "src", "main.js"),
      path.join(projectPath, "index.ts"),
      path.join(projectPath, "index.js"),
    ];
    const entryPath = entryPaths.find((p) => fs.existsSync(p)) ?? null;

    if (!entryPath) {
      return this.buildResult(projectPath, language, null, 0, 0, 0, [], [
        {
          category: "missing_entry",
          severity: "critical",
          location: projectPath,
          message: "No entry point found (src/index.ts, src/main.ts, etc.)",
          suggestion: "Create src/index.ts with the main export or startup logic",
        },
      ]);
    }

    const entryContent = fs.readFileSync(entryPath, "utf-8");

    // Scan src/ for .ts/.js files and check if they're imported
    const srcDir = fs.existsSync(path.join(projectPath, "src"))
      ? path.join(projectPath, "src")
      : projectPath;

    let srcFiles: string[] = [];
    try {
      srcFiles = fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter(
          (d) =>
            d.isFile() &&
            (d.name.endsWith(".ts") || d.name.endsWith(".js")) &&
            !d.name.endsWith(".test.ts") &&
            !d.name.endsWith(".test.js") &&
            !d.name.endsWith(".spec.ts") &&
            d.name !== path.basename(entryPath)
        )
        .map((d) => path.join(srcDir, d.name));
    } catch {
      // ignore
    }

    let modulesConnected = 0;
    let modulesDead = 0;
    const deadModulesList: string[] = [];

    for (const fp of srcFiles) {
      const stem = path.basename(fp).replace(/\.(ts|js)$/, "");
      // Check if the module is imported anywhere in the entry
      const isImported =
        entryContent.includes(`from "./${stem}"`) ||
        entryContent.includes(`from './${stem}'`) ||
        entryContent.includes(`require("./${stem}")`) ||
        entryContent.includes(`require('./${stem}')`);

      if (!isImported) {
        modulesDead++;
        deadModulesList.push(stem);
        findings.push({
          category: "dead_module",
          severity: "warning",
          location: fp,
          message: `Module '${stem}' is not imported in the entry file (${path.basename(entryPath)})`,
          suggestion: `Import and use '${stem}' in ${path.basename(entryPath)} or remove the file`,
        });
      } else {
        modulesConnected++;
      }
    }

    // Also scan sub-directories
    let srcDirs: string[] = [];
    try {
      srcDirs = fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      // ignore
    }

    for (const dir of srcDirs) {
      const isImported =
        entryContent.includes(`from "./${dir}`) ||
        entryContent.includes(`from './${dir}`) ||
        entryContent.includes(`require("./${dir}`) ||
        entryContent.includes(`require('./${dir}`);

      if (!isImported) {
        // Check if directory has substantial content
        const dirPath = path.join(srcDir, dir);
        let fileCount = 0;
        try {
          fileCount = fs
            .readdirSync(dirPath)
            .filter((f) => f.endsWith(".ts") || f.endsWith(".js")).length;
        } catch {
          // ignore
        }
        if (fileCount > 0) {
          modulesDead++;
          deadModulesList.push(dir);
          findings.push({
            category: "dead_module",
            severity: fileCount > 3 ? "error" : "warning",
            location: dirPath,
            message: `Directory module '${dir}' (${fileCount} files) is not imported in ${path.basename(entryPath)}`,
            suggestion: `Import from './${dir}' in ${path.basename(entryPath)} or integrate it into the entry flow`,
          });
        }
      } else {
        modulesConnected++;
      }
    }

    return this.buildResult(
      projectPath,
      language,
      entryPath,
      srcFiles.length + srcDirs.length,
      modulesConnected,
      modulesDead,
      deadModulesList,
      findings
    );
  }

  // ── Go ────────────────────────────────────────────────────────────────────

  private validateGoProject(projectPath: string): ValidateProjectResult {
    const findings: ProjectFinding[] = [];

    const mainGoPath = path.join(projectPath, "main.go");
    if (!fs.existsSync(mainGoPath)) {
      return this.buildResult(projectPath, "go", null, 0, 0, 0, [], [
        {
          category: "missing_entry",
          severity: "critical",
          location: projectPath,
          message: "No main.go found in project root",
          suggestion: "Create main.go with a main() function in package main",
        },
      ]);
    }

    const entryContent = fs.readFileSync(mainGoPath, "utf-8");

    // Find all Go packages in subdirectories
    let subDirs: string[] = [];
    try {
      subDirs = fs
        .readdirSync(projectPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name);
    } catch {
      // ignore
    }

    let modulesConnected = 0;
    let modulesDead = 0;
    const deadModulesList: string[] = [];

    for (const dir of subDirs) {
      const isImported =
        entryContent.includes(`"${dir}"`) ||
        entryContent.includes(`/${dir}"`);

      const dirPath = path.join(projectPath, dir);
      let goFileCount = 0;
      try {
        goFileCount = fs
          .readdirSync(dirPath)
          .filter((f) => f.endsWith(".go")).length;
      } catch {
        // ignore
      }

      if (goFileCount === 0) continue;

      if (!isImported) {
        modulesDead++;
        deadModulesList.push(dir);
        findings.push({
          category: "dead_module",
          severity: goFileCount > 2 ? "error" : "warning",
          location: dirPath,
          message: `Package '${dir}' (${goFileCount} .go files) is not imported in main.go`,
          suggestion: `Import the '${dir}' package in main.go and call its exported functions`,
        });
      } else {
        modulesConnected++;
      }
    }

    return this.buildResult(
      projectPath,
      "go",
      mainGoPath,
      subDirs.length,
      modulesConnected,
      modulesDead,
      deadModulesList,
      findings
    );
  }

  // ── Result builder ────────────────────────────────────────────────────────

  private buildResult(
    projectPath: string,
    language: string,
    entryPath: string | null,
    modulesFound: number,
    modulesConnected: number,
    modulesDead: number,
    deadModules: string[],
    findings: ProjectFinding[]
  ): ValidateProjectResult {
    const blockers = findings.filter(
      (f) => f.severity === "critical" || f.severity === "error"
    );
    const warnings = findings.filter((f) => f.severity === "warning");
    const passed = blockers.length === 0;
    const verdict = passed
      ? `✅ PASSED — ${projectPath} (${modulesConnected}/${modulesFound} modules connected, ${warnings.length} warnings)`
      : `❌ BLOCKED — ${projectPath}: ${blockers.length} blocker(s), ${modulesDead} dead module(s) must be wired into the entry point`;

    return {
      passed,
      path: projectPath,
      language,
      entry_point: entryPath,
      modules_found: modulesFound,
      modules_connected: modulesConnected,
      modules_dead: modulesDead,
      total_issues: findings.length,
      blockers,
      warnings,
      dead_modules: deadModules,
      verdict,
    };
  }
}

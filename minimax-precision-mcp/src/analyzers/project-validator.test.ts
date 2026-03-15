import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ProjectValidator } from "./project-validator.js";

describe("validate_project gate tool", () => {
  const validator = new ProjectValidator();
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-project-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function makeDir(...parts: string[]): string {
    const p = path.join(tmpDir, ...parts);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  }

  // ── Rust tests ─────────────────────────────────────────────────────────────

  it("passes a Rust project whose modules are all wired in main.rs", () => {
    const projDir = makeDir("rust_pass");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod config;
pub use config::Settings;
fn main() {
    let s = Settings::default();
    println!("{:?}", s);
}
`);
    writeFile(path.join(projDir, "src", "config", "mod.rs"), `
#[derive(Debug, Default)]
pub struct Settings {
    pub name: String,
}
`);

    const result = validator.validateProject(projDir);
    expect(result.passed).toBe(true);
    expect(result.dead_modules).not.toContain("config");
    expect(result.verdict).toContain("✅ PASSED");
    expect(result.language).toBe("rust");
  });

  it("blocks when a Rust module has public items but is not imported in main.rs", () => {
    const projDir = makeDir("rust_dead_module");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    // main.rs does NOT declare mod agent
    writeFile(path.join(projDir, "src", "main.rs"), `fn main() { println!("hello"); }\n`);
    // agent module has many public items but is never imported
    writeFile(path.join(projDir, "src", "agent", "mod.rs"), `
pub struct CoordinatorAgent;
pub struct WriterAgent;
pub struct PlotAgent;
pub struct CharacterAgent;
pub fn create_all_agents() -> Vec<String> { vec![] }
`);

    const result = validator.validateProject(projDir);
    expect(result.passed).toBe(false);
    expect(result.dead_modules).toContain("agent");
    const agentBlocker = result.blockers.find(b => b.message.includes("agent"));
    expect(agentBlocker).toBeDefined();
    expect(agentBlocker?.category).toBe("dead_module");
    expect(result.verdict).toContain("❌ BLOCKED");
  });

  it("detects Coordinator struct defined but never instantiated in main.rs", () => {
    const projDir = makeDir("rust_coordinator");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod orchestrator;
fn main() {
    println!("hello");
}
`);
    writeFile(path.join(projDir, "src", "orchestrator", "mod.rs"), `
pub struct Coordinator {
    agents: Vec<String>,
}
impl Coordinator {
    pub fn new() -> Self { Self { agents: vec![] } }
    pub fn run(&self) { }
}
`);

    const result = validator.validateProject(projDir);
    // Should flag that Coordinator::new() is never called
    const coordinatorBlocker = result.blockers.find(
      b => b.category === "disconnected_subsystem"
    );
    expect(coordinatorBlocker).toBeDefined();
    expect(coordinatorBlocker?.message).toContain("Coordinator");
    expect(result.passed).toBe(false);
  });

  it("detects trait method calls that don't exist on the trait", () => {
    const projDir = makeDir("rust_trait_mismatch");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `mod llm;\nfn main() {}\n`);
    writeFile(path.join(projDir, "src", "llm", "mod.rs"), `
pub trait LlmProvider {
    fn generate(&self, prompt: &str) -> String;
}

pub struct MockProvider;

impl LlmProvider for MockProvider {
    fn generate(&self, prompt: &str) -> String {
        // calls self.chat() which is NOT declared on the trait
        self.chat(vec![prompt.to_string()])
    }
}
`);

    const result = validator.validateProject(projDir);
    const traitBlocker = result.blockers.find(b => b.category === "trait_mismatch");
    expect(traitBlocker).toBeDefined();
    expect(traitBlocker?.message).toContain("chat");
  });

  it("reports missing entry point as critical blocker", () => {
    const projDir = makeDir("rust_no_entry");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    // No src/main.rs or src/lib.rs

    const result = validator.validateProject(projDir);
    expect(result.passed).toBe(false);
    expect(result.entry_point).toBeNull();
    const criticalBlocker = result.blockers.find(b => b.category === "missing_entry");
    expect(criticalBlocker).toBeDefined();
    expect(criticalBlocker?.severity).toBe("critical");
  });

  it("throws on non-existent project path", () => {
    expect(() => validator.validateProject("/nonexistent/project/path")).toThrow();
  });

  // ── TypeScript / Node tests ────────────────────────────────────────────────

  it("passes a TypeScript project with all modules imported in index.ts", () => {
    const projDir = makeDir("ts_pass");
    writeFile(path.join(projDir, "package.json"), '{"name":"test"}');
    writeFile(path.join(projDir, "tsconfig.json"), '{"compilerOptions":{}}');
    writeFile(path.join(projDir, "src", "index.ts"), `
import { Server } from "./server";
import { AnalyzerCore } from "./analyzer";
const s = new Server();
const a = new AnalyzerCore();
export { s, a };
`);
    writeFile(path.join(projDir, "src", "server.ts"), `export class Server { run() {} }`);
    writeFile(path.join(projDir, "src", "analyzer.ts"), `export class AnalyzerCore { analyze() {} }`);

    const result = validator.validateProject(projDir);
    expect(result.passed).toBe(true);
    expect(result.language).toBe("typescript");
    expect(result.verdict).toContain("✅ PASSED");
  });

  it("blocks when Rust project has no tests at all", () => {
    const projDir = makeDir("rust_no_tests");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod agent;
mod config;
fn main() { println!("hello"); }
`);
    writeFile(path.join(projDir, "src", "agent.rs"), `pub struct Agent; impl Agent { pub fn run(&self) {} }`);
    writeFile(path.join(projDir, "src", "config.rs"), `pub struct Config; impl Config { pub fn load() -> Self { Self } }`);

    const result = validator.validateProject(projDir);
    const testBlocker = result.blockers.find(b => b.category === "missing_tests");
    expect(testBlocker).toBeDefined();
    expect(testBlocker?.severity).toBe("critical");
    expect(testBlocker?.message).toContain("0 #[test]");
  });

  it("passes zero-test check when project has #[test] functions", () => {
    const projDir = makeDir("rust_has_tests");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod agent;
fn main() { println!("hello"); }
`);
    writeFile(path.join(projDir, "src", "agent.rs"), `
pub struct Agent;
impl Agent { pub fn run(&self) -> String { "done".to_string() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_agent_run() {
        let a = Agent;
        assert_eq!(a.run(), "done");
    }
}
`);

    const result = validator.validateProject(projDir);
    const testBlocker = result.blockers.find(b => b.category === "missing_tests");
    expect(testBlocker).toBeUndefined();
  });

  it("detects empty placeholder .rs module file as error", () => {
    const projDir = makeDir("rust_empty_module");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod agent;
mod workflow;
fn main() { println!("hello"); }
`);
    writeFile(path.join(projDir, "src", "agent.rs"), `
pub struct Agent;
impl Agent { pub fn run(&self) -> String { "done".to_string() } }
#[cfg(test)]
mod tests { use super::*; #[test] fn test_run() { assert_eq!(Agent.run(), "done"); } }
`);
    // workflow.rs is a ghost file — only a comment
    writeFile(path.join(projDir, "src", "workflow.rs"), "// 工作流配置相关\n");

    const result = validator.validateProject(projDir);
    const emptyBlocker = result.blockers.find(b =>
      b.category === "dead_module" && b.message.includes("workflow")
    );
    expect(emptyBlocker).toBeDefined();
    expect(emptyBlocker?.severity).toBe("error");
    expect(emptyBlocker?.message).toContain("empty placeholder");
  });

  it("detects Coordinator defined but tests never call it as warning", () => {
    const projDir = makeDir("rust_coordinator_no_test");
    writeFile(path.join(projDir, "Cargo.toml"), '[package]\nname="test"\nversion="0.1.0"\nedition="2021"\n');
    writeFile(path.join(projDir, "src", "main.rs"), `
mod coordinator;
fn main() { println!("hello"); }
`);
    writeFile(path.join(projDir, "src", "coordinator", "mod.rs"), `
pub struct Coordinator { pub name: String }
impl Coordinator {
    pub fn new(name: String) -> Self { Self { name } }
    pub fn run(&self) { println!("{}", self.name); }
}
`);
    // Integration test only tests a model, never touches Coordinator
    const testsDir = path.join(projDir, "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    writeFile(path.join(testsDir, "integration_test.rs"), `
#[test]
fn test_something_trivial() {
    assert_eq!(2 + 2, 4);
}
`);

    const result = validator.validateProject(projDir);
    const integrationWarning = result.warnings.find(w =>
      w.category === "disconnected_subsystem" && w.message.includes("coordinator.run()")
    );
    expect(integrationWarning).toBeDefined();
  });

  it("warns when a TypeScript file is not imported in index.ts", () => {
    const projDir = makeDir("ts_dead");
    writeFile(path.join(projDir, "package.json"), '{"name":"test"}');
    writeFile(path.join(projDir, "tsconfig.json"), '{"compilerOptions":{}}');
    writeFile(path.join(projDir, "src", "index.ts"), `
import { Server } from "./server";
const s = new Server();
export { s };
`);
    writeFile(path.join(projDir, "src", "server.ts"), `export class Server { run() {} }`);
    // unused.ts is never imported
    writeFile(path.join(projDir, "src", "unused.ts"), `export class UnusedModule { doSomething() {} }`);

    const result = validator.validateProject(projDir);
    expect(result.dead_modules).toContain("unused");
    const deadFinding = result.warnings.find(w => w.message.includes("unused"));
    expect(deadFinding).toBeDefined();
    expect(deadFinding?.category).toBe("dead_module");
  });
});

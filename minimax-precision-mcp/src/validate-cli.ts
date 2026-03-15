#!/usr/bin/env node
/**
 * validate-cli.ts — Claude Code hooks 自动调用的独立验证器
 *
 * 每次 Write/Edit 工具执行后由 hook 自动运行，直接输出校验结果。
 * 模型看到的是真实的 passed/blocked 状态和具体 blocker 列表，
 * 而不是"请调用 validate_file"这样的软提醒。
 *
 * 用法（由 settings.json hook 调用，无需手动执行）：
 *   node dist/validate-cli.js --file <path>       单文件检查
 *   node dist/validate-cli.js --project <dir>     架构检查
 *   node dist/validate-cli.js --gate <dir>        全量检查（所有源文件 + 架构），Stop Hook 使用
 */
import * as fs from "fs";
import * as path from "path";
import { MinimaxPrecisionServer } from "./server.js";
import { ProjectValidator } from "./analyzers/project-validator.js";
import { ValidateFileResult } from "./types.js";

const args = process.argv.slice(2);
const mode = args[0];
const targetPath = args[1];

if (!mode || !targetPath) {
  process.stderr.write(
    "Usage: validate-cli.js --file <path> | --project <path> | --gate <dir>\n"
  );
  process.exit(2);
}

/** Thin wrapper to expose the private runValidateFile method for CLI use. */
class ValidateCLI extends MinimaxPrecisionServer {
  public runFile(fp: string): ValidateFileResult {
    // @ts-expect-error accessing private method for CLI gate
    return this.runValidateFile(fp);
  }
}

/** Recursively collect source files under dir, bounded to common extensions. */
function walkSourceFiles(dir: string, depth = 0): string[] {
  const MAX_DEPTH = 8;
  if (depth > MAX_DEPTH) return [];
  const SOURCE_EXTS = new Set([".rs", ".ts", ".tsx", ".go", ".java", ".py", ".js"]);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip build / test / vendor dirs
      if (["target", "node_modules", "dist", ".git", "vendor"].includes(entry.name)) continue;
      files.push(...walkSourceFiles(full, depth + 1));
    } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
      // Skip test files for the per-file gate (they're allowed to have unwrap etc.)
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
      files.push(full);
    }
  }
  return files;
}

function printFileBlocked(targetPath: string, result: ValidateFileResult): void {
  process.stdout.write(
    `[MCP ❌ BLOCKED] ${targetPath} — ${result.blockers.length} 个问题必须修复:\n`
  );
  for (const b of result.blockers) {
    process.stdout.write(`  🚫 [${b.category}] ${b.location}: ${b.message}\n`);
    if (b.suggestion) {
      process.stdout.write(`     建议: ${b.suggestion}\n`);
    }
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`  （另有 ${result.warnings.length} 条警告，不阻塞）\n`);
  }
}

if (mode === "--file") {
  try {
    const cli = new ValidateCLI();
    const result = cli.runFile(targetPath);

    if (result.passed) {
      process.stdout.write(`[MCP ✅] ${result.verdict}\n`);
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          process.stdout.write(
            `  ⚠️  [${w.category}] ${w.location}: ${w.message}\n`
          );
        }
      }
      process.exit(0);
    } else {
      printFileBlocked(targetPath, result);
      process.stdout.write(
        [
          "",
          "╔══════════════════════════════════════════════════════════════════╗",
          "║  ⛔  CLAUDE: 你当前的响应必须立即停止并修复上述所有 blockers     ║",
          "║                                                                  ║",
          "║  1. 逐条修复 blockers[] 中列出的每一个问题                       ║",
          "║  2. 重新 Write/Edit 受影响的文件（会自动触发再次校验）            ║",
          "║  3. 直到看到 [MCP ✅] 才能继续下一步                             ║",
          "║                                                                  ║",
          "║  【禁止】通过删代码 / 简化逻辑 来消除错误                        ║",
          "║  【禁止】在看到 ✅ 之前报告任何进度或完成状态                    ║",
          "╚══════════════════════════════════════════════════════════════════╝",
          "",
        ].join("\n")
      );
      process.exit(1);
    }
  } catch (err) {
    process.stdout.write(`[MCP ⚠️] validate_file 出错 (${targetPath}): ${err}\n`);
    process.exit(0);
  }

} else if (mode === "--project") {
  try {
    const validator = new ProjectValidator();
    const result = validator.validateProject(targetPath);

    if (result.passed) {
      process.stdout.write(
        `[MCP ✅] PROJECT ${result.modules_connected}/${result.modules_found} 模块已接入主执行路径\n`
      );
      process.exit(0);
    } else {
      process.stdout.write(
        `[MCP ❌ BLOCKED] PROJECT — ${result.blockers.length} 个架构问题必须修复:\n`
      );
      for (const b of result.blockers) {
        process.stdout.write(`  🚫 [${b.category}] ${b.location}:\n`);
        process.stdout.write(`     ${b.message}\n`);
        if (b.suggestion) {
          process.stdout.write(`     建议: ${b.suggestion}\n`);
        }
      }
      if (result.dead_modules.length > 0) {
        process.stdout.write(`  断连模块: ${result.dead_modules.join(", ")}\n`);
      }
      if (result.warnings.length > 0) {
        process.stdout.write(`  （另有 ${result.warnings.length} 条架构警告）\n`);
      }
      process.stdout.write(
        [
          "",
          "╔══════════════════════════════════════════════════════════════════╗",
          "║  ⛔  CLAUDE: 你当前的响应必须立即停止并修复上述架构问题           ║",
          "║                                                                  ║",
          "║  dead_module    → 在入口文件添加 mod xxx; 并实例化/调用其类型    ║",
          "║  disconnected   → 在 main() 中构造 Coordinator 并调用其方法      ║",
          "║  trait_mismatch → 在 trait 定义中添加缺失方法并在所有 impl 实现  ║",
          "║  missing_tests  → 为每个非平凡模块添加至少一个 #[test]           ║",
          "║                                                                  ║",
          "║  修复后 Write/Edit 受影响文件，等待 [MCP ✅] 后才能继续          ║",
          "║  【禁止】在看到 ✅ PROJECT 之前报告任何进度或完成状态            ║",
          "╚══════════════════════════════════════════════════════════════════╝",
          "",
        ].join("\n")
      );
      process.exit(1);
    }
  } catch (err) {
    process.stdout.write(`[MCP ⚠️] validate_project 出错 (${targetPath}): ${err}\n`);
    process.exit(0);
  }

} else if (mode === "--gate") {
  // ── Full gate: scan ALL source files + architecture check ─────────────────
  // Used by Stop Hook to perform the equivalent of /mcp-gate automatically
  // after every response turn.
  const projectDir = targetPath;
  const srcDir = fs.existsSync(path.join(projectDir, "src"))
    ? path.join(projectDir, "src")
    : projectDir;

  const cli = new ValidateCLI();
  const sourceFiles = walkSourceFiles(srcDir);

  let totalFileBlockers = 0;
  let totalFileWarnings = 0;
  const blockedFiles: string[] = [];

  // Per-file validation
  for (const fp of sourceFiles) {
    try {
      const result = cli.runFile(fp);
      if (!result.passed) {
        totalFileBlockers += result.blockers.length;
        totalFileWarnings += result.warnings.length;
        blockedFiles.push(fp);
        printFileBlocked(fp, result);
        process.stdout.write("\n");
      } else {
        totalFileWarnings += result.warnings.length;
      }
    } catch {
      // individual file error — skip silently
    }
  }

  // Architecture validation
  let projectBlocked = false;
  try {
    const validator = new ProjectValidator();
    const result = validator.validateProject(projectDir);

    if (!result.passed) {
      projectBlocked = true;
      process.stdout.write(
        `[MCP ❌ BLOCKED] PROJECT — ${result.blockers.length} 个架构问题:\n`
      );
      for (const b of result.blockers) {
        process.stdout.write(`  🚫 [${b.category}] ${b.location}:\n`);
        process.stdout.write(`     ${b.message}\n`);
        if (b.suggestion) {
          process.stdout.write(`     建议: ${b.suggestion}\n`);
        }
      }
      if (result.dead_modules.length > 0) {
        process.stdout.write(`  断连模块: ${result.dead_modules.join(", ")}\n`);
      }
    } else {
      process.stdout.write(
        `[MCP ✅] PROJECT ${result.modules_connected}/${result.modules_found} 模块已接入主执行路径\n`
      );
    }
  } catch (err) {
    process.stdout.write(`[MCP ⚠️] validate_project 出错: ${err}\n`);
  }

  const hasBlockers = totalFileBlockers > 0 || projectBlocked;

  if (hasBlockers) {
    process.stdout.write(
      [
        "",
        `  扫描了 ${sourceFiles.length} 个源文件，发现 ${blockedFiles.length} 个文件有 blocker，${totalFileWarnings} 条警告`,
        "",
        "╔══════════════════════════════════════════════════════════════════╗",
        "║  ⛔  CLAUDE: 全量检查未通过，必须修复所有 blockers 后才能结束   ║",
        "║                                                                  ║",
        "║  1. 逐条修复以上所有 🚫 条目                                    ║",
        "║  2. 重新保存受影响的文件触发自动校验                             ║",
        "║  3. 直到所有文件和 PROJECT 均显示 [MCP ✅] 才能报告完成         ║",
        "║                                                                  ║",
        "║  【禁止】通过删代码 / 简化逻辑 来消除错误                        ║",
        "║  【禁止】声称[误报]绕过检查——如有争议请明确指出具体规则冲突    ║",
        "╚══════════════════════════════════════════════════════════════════╝",
        "",
      ].join("\n")
    );
    process.exit(1);
  } else {
    process.stdout.write(
      `\n[MCP ✅] GATE PASSED — ${sourceFiles.length} 个文件全部通过，架构检查通过\n`
    );
    process.exit(0);
  }

} else {
  process.stderr.write(`未知模式: ${mode}\n`);
  process.exit(2);
}

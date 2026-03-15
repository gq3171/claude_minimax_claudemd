import { AnalysisIssue } from '../types.js';

export class ErrorHandlingAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');
    const isRust = filePath.endsWith('.rs');

    // ── Rust-only file-level checks ──────────────────────────────────────────

    if (isRust) {
      // 检测 #[allow(dead_code)] 滥用
      // 1-2 处可能是有意为之（接口稳定性）；3+ 处说明系统性抑制，是 error
      const allowDeadCodeCount = (sourceCode.match(/#\[allow\(dead_code\)\]/g) ?? []).length;
      if (allowDeadCodeCount >= 3) {
        issues.push({
          type: "error_handling",
          message: `Found ${allowDeadCodeCount} #[allow(dead_code)] annotations — systematic suppression hides unimplemented or disconnected framework code`,
          location: { file: filePath, line: 1 },
          severity: 'error',
          suggestion: 'Remove unused items or wire them into the execution path; do not suppress compiler warnings'
        });
      } else if (allowDeadCodeCount >= 1) {
        issues.push({
          type: "error_handling",
          message: `Found ${allowDeadCodeCount} #[allow(dead_code)] annotation(s) — suppresses dead code warnings`,
          location: { file: filePath, line: 1 },
          severity: 'warning',
          suggestion: 'Consider removing the unused item or calling it from the main execution path'
        });
      }

      // 检测 .unwrap() 在生产代码中（跳过 #[cfg(test)] 块之后的代码）
      // 策略：找到第一个 #[cfg(test)] 或 "mod tests {" 的行，之后的行视为测试代码跳过
      let testBlockStartLine = -1;
      lines.forEach((line, index) => {
        if (testBlockStartLine !== -1) return;
        const trimmed = line.trim();
        if (trimmed === '#[cfg(test)]' || /^mod\s+tests\s*\{/.test(trimmed)) {
          testBlockStartLine = index;
        }
      });

      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        // 跳过测试代码
        if (testBlockStartLine !== -1 && index >= testBlockStartLine) return;
        // 跳过注释行
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) return;

        // .unwrap() 紧跟在 Result 生成操作之后 → error（明显应该用 ?）
        // 使用 includes 检测同行中既有 Result 操作又有 .unwrap()，
        // 避免 regex 被嵌套括号干扰（如 .map_err(|e| Foo(e)).unwrap()）
        const hasResultOp =
          line.includes('.map_err(') ||
          line.includes('.ok_or(') ||
          line.includes('.ok_or_else(') ||
          /\.build\(\)\s*\.unwrap\(\)/.test(line);
        if (hasResultOp && line.includes('.unwrap()')) {
          issues.push({
            type: "error_handling",
            message: '.unwrap() after a Result-producing operation — use ? operator instead',
            location: { file: filePath, line: lineNumber },
            severity: 'error',
            suggestion: 'Replace .unwrap() with ? to propagate the error up the call stack'
          });
        } else if (line.includes('.unwrap()')) {
          issues.push({
            type: "error_handling",
            message: '.unwrap() will panic on None/Err in production code',
            location: { file: filePath, line: lineNumber },
            severity: 'warning',
            suggestion: 'Use ?, match, or if let for explicit error handling'
          });
        }
      });
    }

    // ── Per-line checks (all languages) ─────────────────────────────────────

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // 检测 .unwrap_or_default()
      if (line.includes('.unwrap_or_default()')) {
        issues.push({
          type: "error_handling",
          message: 'Using .unwrap_or_default() silently discards error information',
          location: { file: filePath, line: lineNumber },
          severity: 'error',
          suggestion: 'Use ? operator or .map_err() to propagate the error with context'
        });
      }

      // 检测 .unwrap_or("")
      if (line.match(/\.unwrap_or\s*\(\s*""\s*\)/)) {
        issues.push({
          type: "error_handling",
          message: 'Using .unwrap_or("") silently converts errors to empty strings',
          location: { file: filePath, line: lineNumber },
          severity: 'error',
          suggestion: 'Propagate the error or map it to a meaningful error type'
        });
      }

      // 检测 .unwrap_or(0) 等零值
      if (line.match(/\.unwrap_or\s*\(\s*0\s*\)/)) {
        issues.push({
          type: "error_handling",
          message: 'Using .unwrap_or(0) silently converts errors to zero',
          location: { file: filePath, line: lineNumber },
          severity: 'warning',
          suggestion: 'Consider if zero is a valid fallback or if the error should be propagated'
        });
      }

      // 检测 unwrap_or_else(|_| ...) - 忽略错误
      if (line.match(/\.unwrap_or_else\s*\(\s*\|_\|/)) {
        issues.push({
          type: "error_handling",
          message: 'unwrap_or_else ignores error with |_| - error information is lost',
          location: { file: filePath, line: lineNumber },
          severity: 'warning',
          suggestion: 'At minimum, log the error before providing fallback value'
        });
      }
    });

    return issues;
  }
}

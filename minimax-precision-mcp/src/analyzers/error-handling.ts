import { AnalysisIssue } from '../types.js';

export class ErrorHandlingAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');
    const isRust = filePath.endsWith('.rs');

    // ── Rust-only file-level checks ──────────────────────────────────────────

    if (isRust) {
      // ── 文件级全局编译器警告压制（#![allow(...)]）→ error ─────────────────
      // #![allow(...)] 是 crate/module 级别，会静默整个文件的警告，是最危险的抑制形式
      const crateAllowPatterns: Array<{ pattern: RegExp; name: string }> = [
        { pattern: /#!\[allow\(dead_code\)\]/g, name: 'dead_code' },
        { pattern: /#!\[allow\(unused_variables\)\]/g, name: 'unused_variables' },
        { pattern: /#!\[allow\(unused_imports\)\]/g, name: 'unused_imports' },
        { pattern: /#!\[allow\(unused\)\]/g, name: 'unused' },
      ];
      for (const { pattern, name } of crateAllowPatterns) {
        if (pattern.test(sourceCode)) {
          issues.push({
            type: "error_handling",
            message: `#![allow(${name})] suppresses compiler warnings for the entire file — hides incomplete or dead code`,
            location: { file: filePath, line: 1 },
            severity: 'error',
            suggestion: `Remove #![allow(${name})], fix the underlying warnings individually instead of silencing them globally`
          });
        }
      }

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

        // let _name = expr — 有名字的计算结果丢弃 → error
        // 如 `let _response = provider.chat(...).await?` — 调用了 API 但把结果扔掉
        // 区别：`let _ = expr` 是 Rust 惯用的显式丢弃（仍有警告价值但不如命名丢弃严重）
        const namedDiscardMatch = trimmed.match(/^let\s+_([a-zA-Z]\w*)\s*[=:]/);
        if (namedDiscardMatch) {
          issues.push({
            type: "error_handling",
            message: `let _${namedDiscardMatch[1]} = ... discards the computed value — the result is never used`,
            location: { file: filePath, line: lineNumber },
            severity: 'error',
            suggestion: `Use the returned value: bind it to a real variable and pass it to the consumer. If intentionally ignored, use 'let _ = ...' with a comment explaining why`
          });
        }

        // 单行 stub 返回 → warning
        // 检测函数体中只有一行且是空值/None/空vec的模式
        // 这些往往是"函数签名写了但逻辑没实现"的骗局
        const stubReturnPatterns = [
          /^\s*None\s*$/,
          /^\s*vec!\s*\[\s*\]\s*$/,
          /^\s*Ok\s*\(\s*vec!\s*\[\s*\]\s*\)\s*$/,
          /^\s*Ok\s*\(\s*None\s*\)\s*$/,
          /^\s*Ok\s*\(\s*String::new\s*\(\s*\)\s*\)\s*$/,
          /^\s*Ok\s*\(\s*HashMap::new\s*\(\s*\)\s*\)\s*$/,
          /^\s*Err\s*\(\s*"not\s+implemented/i,
        ];
        // 仅在前一行是 { 时（说明这是整个函数体）才报告，减少误报
        const prevTrimmed = index > 0 ? lines[index - 1].trim() : '';
        const isEntireFunctionBody = prevTrimmed.endsWith('{') || prevTrimmed === '{';
        if (isEntireFunctionBody && stubReturnPatterns.some(p => p.test(line))) {
          issues.push({
            type: "error_handling",
            message: `Function body is a single stub return (${trimmed}) — no real logic implemented`,
            location: { file: filePath, line: lineNumber },
            severity: 'warning',
            suggestion: 'Implement the actual logic; returning None/vec![]/Ok(empty) as the only statement means the function does nothing'
          });
        }

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

      // .unwrap_or(TypeName { ... }) / .unwrap_or(TypeName::new()) — 假数据兜底
      // 这种模式在解析失败时返回硬编码的结构体（如 ReviewResult { score: 5.0 }），
      // 让下游代码收到看起来合法的虚假数据，掩盖了真实错误（如 LLM 返回格式不对）
      if (line.match(/\.unwrap_or\s*\(\s*[A-Z]\w*\s*\{/) ||
          line.match(/\.unwrap_or\s*\(\s*[A-Z]\w*\s*::\s*new\s*\(/)) {
        issues.push({
          type: "error_handling",
          message: '.unwrap_or(StructLiteral { ... }) substitutes hardcoded fake data on error — the real error is silently swallowed and downstream code receives fabricated values',
          location: { file: filePath, line: lineNumber },
          severity: 'error',
          suggestion: 'Return Err(...) or propagate with ? instead of substituting fake data. If a fallback is truly needed, at minimum log the original error first.'
        });
      }
    });

    return issues;
  }
}

import { AnalysisIssue } from '../types.js';

export class ErrorHandlingAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');

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

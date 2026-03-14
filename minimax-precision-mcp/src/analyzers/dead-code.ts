import { AnalysisIssue } from '../types.js';

export class DeadCodeAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');

    // 提取所有公共函数定义
    const publicFunctions = new Set<string>();
    const functionCalls = new Set<string>();

    lines.forEach((line) => {
      // Rust: pub fn function_name 或 pub async fn function_name
      const rustPubFn = line.match(/pub\s+(?:async\s+)?fn\s+(\w+)/);
      if (rustPubFn) {
        publicFunctions.add(rustPubFn[1]);
      }

      // TypeScript/JavaScript: export function functionName
      const tsFn = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
      if (tsFn) {
        publicFunctions.add(tsFn[1]);
      }

      // 提取函数调用：先把定义关键字（fn X / function X）从行中剥离，
      // 避免将被定义的函数名本身误认为调用，但保留同行内的其他调用。
      const lineForCalls = line
        .replace(/(?:pub\s+)?(?:async\s+)?fn\s+\w+/, "")
        .replace(/(?:export\s+)?(?:async\s+)?function\s+\w+/, "");

      const calls = lineForCalls.matchAll(/\b(\w+)\s*\(/g);
      for (const call of calls) {
        functionCalls.add(call[1]);
      }
    });

    // 检测定义但从未被调用的公共函数
    publicFunctions.forEach(funcName => {
      if (!functionCalls.has(funcName) && funcName !== 'main' && funcName !== 'new') {
        const lineNumber = lines.findIndex(line =>
          line.includes(`pub fn ${funcName}`) ||
          line.includes(`pub async fn ${funcName}`) ||
          line.includes(`export function ${funcName}`)
        ) + 1;

        issues.push({
          type: "dead_code",
          message: `Public function '${funcName}' is defined but never called`,
          location: { file: filePath, line: lineNumber },
          severity: 'warning',
          suggestion: 'Remove unused function or ensure it is called from the main execution path'
        });
      }
    });

    return issues;
  }
}

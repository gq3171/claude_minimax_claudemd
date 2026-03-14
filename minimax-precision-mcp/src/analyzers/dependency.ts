import { AnalysisIssue } from '../types.js';

export class DependencyAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');

    // 提取所有函数定义
    const definedFunctions = new Set<string>();
    const calledFunctions = new Map<string, number[]>(); // 函数名 -> 调用行号

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // 提取函数定义
      const rustFn = line.match(/(?:pub\s+)?fn\s+(\w+)/);
      const tsFn = line.match(/(?:export\s+)?function\s+(\w+)/);

      if (rustFn) definedFunctions.add(rustFn[1]);
      if (tsFn) definedFunctions.add(tsFn[1]);

      // 提取函数调用（排除函数定义）
      if (!line.includes('fn ') && !line.includes('function ')) {
        const calls = line.matchAll(/(\w+)\s*\(/g);
        for (const call of calls) {
          const funcName = call[1];
          if (!calledFunctions.has(funcName)) {
            calledFunctions.set(funcName, []);
          }
          calledFunctions.get(funcName)!.push(lineNumber);
        }
      }
    });

    // 检查未定义的函数调用
    calledFunctions.forEach((lineNumbers, funcName) => {
      // 排除标准库函数和常见函数
      const stdFunctions = ['println', 'print', 'format', 'vec', 'Some', 'None', 'Ok', 'Err',
                           'console', 'log', 'error', 'warn', 'String', 'Number', 'Array'];

      if (!definedFunctions.has(funcName) && !stdFunctions.includes(funcName)) {
        issues.push({
          type: "missing_dependency",
          message: `Function '${funcName}' is called but not defined in this file`,
          location: { file: filePath, line: lineNumbers[0] },
          severity: 'warning',
          suggestion: 'Ensure the function is defined or imported from another module'
        });
      }
    });

    return issues;
  }
}

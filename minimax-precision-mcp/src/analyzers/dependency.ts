import { AnalysisIssue } from '../types.js';
import * as path from 'path';

// Standard/built-in identifiers per language that should not be flagged as missing
const STD_FUNCTIONS: Record<string, string[]> = {
  rust: [
    'println', 'print', 'eprintln', 'eprint', 'format', 'write', 'writeln',
    'vec', 'Some', 'None', 'Ok', 'Err', 'Box', 'Arc', 'Rc', 'Cell', 'RefCell',
    'String', 'Vec', 'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet',
    'assert', 'assert_eq', 'assert_ne', 'panic', 'todo', 'unimplemented',
    'unreachable', 'dbg', 'matches', 'cfg', 'env',
  ],
  typescript: [
    'console', 'log', 'error', 'warn', 'info', 'debug',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'Symbol', 'BigInt',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'JSON', 'Math', 'Date', 'RegExp', 'Error',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
    'require', 'module', 'exports', 'process', 'Buffer',
  ],
  javascript: [
    'console', 'log', 'error', 'warn', 'info', 'debug',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'Symbol',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'Promise', 'JSON', 'Math', 'Date', 'RegExp', 'Error',
    'Map', 'Set', 'require', 'module', 'exports', 'process', 'Buffer',
  ],
  go: [
    'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'close',
    'panic', 'recover', 'print', 'println', 'complex', 'real', 'imag',
    'fmt', 'Println', 'Printf', 'Sprintf', 'Errorf', 'Fprintf',
    'errors', 'New',
  ],
  java: [
    'System', 'out', 'println', 'printf', 'print', 'err',
    'String', 'Integer', 'Long', 'Double', 'Boolean', 'Object',
    'Math', 'Arrays', 'Collections', 'Objects',
    'toString', 'equals', 'hashCode', 'compareTo',
    'super', 'this',
  ],
  python: [
    'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'sorted',
    'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool', 'bytes',
    'open', 'input', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr',
    'setattr', 'delattr', 'vars', 'dir', 'repr', 'abs', 'round', 'min', 'max',
    'sum', 'all', 'any', 'iter', 'next', 'reversed',
  ],
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath);
  const extMap: Record<string, string> = {
    '.rs': 'rust',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.go': 'go',
    '.java': 'java',
    '.py': 'python',
  };
  return extMap[ext] ?? 'unknown';
}

export class DependencyAnalyzer {
  analyze(sourceCode: string, filePath: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = sourceCode.split('\n');
    const language = detectLanguage(filePath);
    const stdFunctions = new Set<string>(STD_FUNCTIONS[language] ?? []);

    // 提取所有函数定义
    const definedFunctions = new Set<string>();
    const calledFunctions = new Map<string, number[]>(); // 函数名 -> 调用行号

    // Matches any function definition keyword so we can skip those lines for call detection
    const definitionPattern =
      /(?:pub\s+)?(?:async\s+)?fn\s+\w+|(?:export\s+)?(?:async\s+)?function\s+\w+|def\s+\w+|func\s+\w+|\w+\s+\w+\s*\([^)]*\)\s*\{/;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;

      // 提取函数定义（Rust 和 TypeScript/JS）
      const rustFn = line.match(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      const tsFn = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      const pyFn = line.match(/def\s+(\w+)/);
      const goFn = line.match(/func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/);

      if (rustFn) definedFunctions.add(rustFn[1]);
      if (tsFn) definedFunctions.add(tsFn[1]);
      if (pyFn) definedFunctions.add(pyFn[1]);
      if (goFn) definedFunctions.add(goFn[1]);

      // 提取函数调用（排除函数定义行）
      if (!definitionPattern.test(line)) {
        const calls = line.matchAll(/\b(\w+)\s*\(/g);
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
      if (!definedFunctions.has(funcName) && !stdFunctions.has(funcName)) {
        issues.push({
          type: "missing_dependency",
          message: `Function '${funcName}' is called but not defined in this file`,
          location: { file: filePath, line: lineNumbers[0] },
          severity: 'warning',
          suggestion: 'Ensure the function is defined or imported from another module',
        });
      }
    });

    return issues;
  }
}

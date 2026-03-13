import { FunctionIR, Issue } from "../types.js";

export class PlaceholderAnalyzer {
  analyze(func: FunctionIR): Issue[] {
    const issues: Issue[] = [];

    if (func.body.isEmpty) {
      issues.push({
        type: "empty_function",
        severity: "critical",
        location: {
          file: func.filePath,
          line: func.lineNumber,
          column: 0,
        },
        message: `函数 '${func.name}' 是空函数体`,
        details: { functionName: func.name },
      });
    }

    if (func.body.hasPlaceholder) {
      issues.push({
        type: "placeholder_return",
        severity: "critical",
        location: {
          file: func.filePath,
          line: func.lineNumber,
          column: 0,
        },
        message: `函数 '${func.name}' 包含占位符 (todo!, unimplemented!)`,
        details: { functionName: func.name },
      });
    }

    return issues;
  }
}

import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import { FunctionIR, Issue } from "../types.js";
import * as fs from "fs";

export class ParameterAnalyzer {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
  }

  analyze(func: FunctionIR): Issue[] {
    const issues: Issue[] = [];
    const sourceCode = fs.readFileSync(func.filePath, "utf-8");
    const tree = this.parser.parse(sourceCode);

    for (const param of func.signature.parameters) {
      if (param.name.startsWith("_")) {
        issues.push({
          type: "unused_parameter",
          severity: "error",
          location: {
            file: func.filePath,
            line: func.lineNumber,
            column: 0,
          },
          message: `参数 '${param.name}' 使用 _ 前缀被忽略`,
          details: { parameterName: param.name, functionName: func.name },
        });
        continue;
      }

      const isUsed = this.checkParameterUsage(tree.rootNode, func.name, param.name, sourceCode);
      if (!isUsed) {
        issues.push({
          type: "unused_parameter",
          severity: "error",
          location: {
            file: func.filePath,
            line: func.lineNumber,
            column: 0,
          },
          message: `参数 '${param.name}' 未被使用`,
          details: { parameterName: param.name, functionName: func.name },
        });
      }
    }

    return issues;
  }

  private checkParameterUsage(node: Parser.SyntaxNode, funcName: string, paramName: string, sourceCode: string): boolean {
    if (node.type === "function_item") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const currentFuncName = sourceCode.substring(nameNode.startIndex, nameNode.endIndex);
        if (currentFuncName === funcName) {
          const body = node.childForFieldName("body");
          if (body) {
            return this.searchIdentifier(body, paramName, sourceCode);
          }
        }
      }
    }

    for (const child of node.children) {
      if (this.checkParameterUsage(child, funcName, paramName, sourceCode)) {
        return true;
      }
    }

    return false;
  }

  private searchIdentifier(node: Parser.SyntaxNode, identifier: string, sourceCode: string): boolean {
    if (node.type === "identifier") {
      const text = sourceCode.substring(node.startIndex, node.endIndex);
      if (text === identifier) return true;
    }

    for (const child of node.children) {
      if (this.searchIdentifier(child, identifier, sourceCode)) {
        return true;
      }
    }

    return false;
  }
}

import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import { FunctionIR, Parameter } from "../types.js";
import * as fs from "fs";

export class PythonParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  parseFile(filePath: string): FunctionIR[] {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    const tree = this.parser.parse(sourceCode);
    return this.extractFunctions(tree.rootNode, filePath, sourceCode);
  }

  private extractFunctions(node: Parser.SyntaxNode, filePath: string, sourceCode: string): FunctionIR[] {
    const functions: FunctionIR[] = [];

    if (node.type === "function_definition") {
      const func = this.parseFunctionNode(node, filePath, sourceCode);
      if (func) functions.push(func);
    }

    for (const child of node.children) {
      functions.push(...this.extractFunctions(child, filePath, sourceCode));
    }

    return functions;
  }

  private parseFunctionNode(node: Parser.SyntaxNode, filePath: string, sourceCode: string): FunctionIR | null {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return null;

    const name = sourceCode.substring(nameNode.startIndex, nameNode.endIndex);
    const parameters = this.extractParameters(node, sourceCode);
    const returnType = this.extractReturnType(node, sourceCode);
    const body = node.childForFieldName("body");

    return {
      name,
      filePath,
      lineNumber: node.startPosition.row + 1,
      signature: {
        parameters,
        returnType,
      },
      body: {
        isEmpty: this.isBodyEmpty(body),
        hasPlaceholder: this.hasPlaceholder(body, sourceCode),
      },
      metadata: {
        language: "python",
        isAsync: this.isAsync(node),
      },
    };
  }

  private extractParameters(node: Parser.SyntaxNode, sourceCode: string): Parameter[] {
    const params: Parameter[] = [];
    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) return params;

    for (const child of paramsNode.children) {
      if (child.type === "identifier") {
        const paramName = sourceCode.substring(child.startIndex, child.endIndex);
        if (paramName !== "self" && paramName !== "cls") {
          params.push({
            name: paramName,
            type: "Any",
            isUsed: false,
            usageLocations: [],
          });
        }
      }
    }

    return params;
  }

  private extractReturnType(node: Parser.SyntaxNode, sourceCode: string): string {
    const returnTypeNode = node.childForFieldName("return_type");
    if (!returnTypeNode) return "None";
    return sourceCode.substring(returnTypeNode.startIndex, returnTypeNode.endIndex);
  }

  private isBodyEmpty(bodyNode: Parser.SyntaxNode | null): boolean {
    if (!bodyNode) return true;
    const bodyText = bodyNode.text.trim();
    return bodyText === "pass" || bodyText === "";
  }

  private hasPlaceholder(bodyNode: Parser.SyntaxNode | null, sourceCode: string): boolean {
    if (!bodyNode) return false;
    const bodyText = sourceCode.substring(bodyNode.startIndex, bodyNode.endIndex);
    return /raise NotImplementedError/.test(bodyText);
  }

  private isAsync(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === "async") return true;
    }
    return false;
  }
}

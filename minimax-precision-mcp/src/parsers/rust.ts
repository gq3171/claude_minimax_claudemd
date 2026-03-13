import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import { FunctionIR, Parameter } from "../types.js";
import * as fs from "fs";

export class RustParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
  }

  parseFile(filePath: string): FunctionIR[] {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    const tree = this.parser.parse(sourceCode);
    return this.extractFunctions(tree.rootNode, filePath, sourceCode);
  }

  private extractFunctions(node: Parser.SyntaxNode, filePath: string, sourceCode: string): FunctionIR[] {
    const functions: FunctionIR[] = [];

    if (node.type === "function_item") {
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
        language: "rust",
        isAsync: this.isAsync(node),
      },
    };
  }

  private extractParameters(node: Parser.SyntaxNode, sourceCode: string): Parameter[] {
    const params: Parameter[] = [];
    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) return params;

    for (const child of paramsNode.children) {
      if (child.type === "parameter") {
        const patternNode = child.childForFieldName("pattern");
        const typeNode = child.childForFieldName("type");

        if (patternNode) {
          const paramName = sourceCode.substring(patternNode.startIndex, patternNode.endIndex);
          const paramType = typeNode ? sourceCode.substring(typeNode.startIndex, typeNode.endIndex) : "unknown";

          params.push({
            name: paramName,
            type: paramType,
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
    if (!returnTypeNode) return "()";
    return sourceCode.substring(returnTypeNode.startIndex, returnTypeNode.endIndex);
  }

  private isBodyEmpty(bodyNode: Parser.SyntaxNode | null): boolean {
    if (!bodyNode) return true;
    const statements = bodyNode.children.filter(c => c.type !== "{" && c.type !== "}");
    return statements.length === 0;
  }

  private hasPlaceholder(bodyNode: Parser.SyntaxNode | null, sourceCode: string): boolean {
    if (!bodyNode) return false;
    const bodyText = sourceCode.substring(bodyNode.startIndex, bodyNode.endIndex);
    return /todo!|unimplemented!|unreachable!/.test(bodyText);
  }

  private isAsync(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === "async") return true;
    }
    return false;
  }
}

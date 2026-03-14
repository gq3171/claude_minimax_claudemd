import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import { FunctionIR, Parameter } from "../types.js";
import * as fs from "fs";

export class TypeScriptParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript.typescript);
  }

  parseFile(filePath: string): FunctionIR[] {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    const tree = this.parser.parse(sourceCode);
    return this.extractFunctions(tree.rootNode, filePath, sourceCode);
  }

  private extractFunctions(node: Parser.SyntaxNode, filePath: string, sourceCode: string): FunctionIR[] {
    const functions: FunctionIR[] = [];

    if (node.type === "function_declaration" || node.type === "method_definition") {
      const func = this.parseFunctionNode(node, filePath, sourceCode);
      if (func) functions.push(func);
    } else if (
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      // Handle: const foo = (x) => { ... } / const foo = function(...) { ... }
      for (const child of node.children) {
        if (child.type === "variable_declarator") {
          const nameNode = child.childForFieldName("name");
          const valueNode = child.childForFieldName("value");
          if (
            nameNode &&
            valueNode &&
            (valueNode.type === "arrow_function" ||
              valueNode.type === "function_expression")
          ) {
            const func = this.parseArrowFunctionNode(
              valueNode,
              nameNode,
              filePath,
              sourceCode
            );
            if (func) functions.push(func);
          }
        }
      }
    }

    for (const child of node.children) {
      functions.push(...this.extractFunctions(child, filePath, sourceCode));
    }

    return functions;
  }

  private parseArrowFunctionNode(
    node: Parser.SyntaxNode,
    nameNode: Parser.SyntaxNode,
    filePath: string,
    sourceCode: string
  ): FunctionIR | null {
    const name = sourceCode.substring(nameNode.startIndex, nameNode.endIndex);
    const parameters = this.extractParameters(node, sourceCode);
    const returnType = this.extractReturnType(node, sourceCode);
    const body = node.childForFieldName("body");

    return {
      name,
      filePath,
      lineNumber: node.startPosition.row + 1,
      signature: { parameters, returnType },
      body: {
        isEmpty: this.isBodyEmpty(body),
        hasPlaceholder: this.hasPlaceholder(body, sourceCode),
      },
      metadata: {
        language: "typescript",
        isAsync: this.isAsync(node),
      },
    };
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
        language: "typescript",
        isAsync: this.isAsync(node),
      },
    };
  }

  private extractParameters(node: Parser.SyntaxNode, sourceCode: string): Parameter[] {
    const params: Parameter[] = [];
    const paramsNode = node.childForFieldName("parameters");
    if (!paramsNode) return params;

    for (const child of paramsNode.children) {
      if (child.type === "required_parameter" || child.type === "optional_parameter") {
        const patternNode = child.childForFieldName("pattern");
        const typeNode = child.childForFieldName("type");

        if (patternNode) {
          const paramName = sourceCode.substring(patternNode.startIndex, patternNode.endIndex);
          const paramType = typeNode ? sourceCode.substring(typeNode.startIndex, typeNode.endIndex) : "any";

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
    if (!returnTypeNode) return "void";
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
    // Match single/double/template-quoted "not implemented" / "TODO" throw statements
    // and comment-based placeholders
    return /throw\s+new\s+Error\s*\(\s*["'`](?:not implemented|TODO)["'`]\s*\)/.test(
      bodyText
    );
  }

  private isAsync(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === "async") return true;
    }
    return false;
  }
}

import Parser from "tree-sitter";
import Rust from "tree-sitter-rust";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import { FunctionIR, Issue } from "../types.js";
import * as fs from "fs";

// Language → { parser, function node types for AST traversal }
interface LanguageConfig {
  parser: Parser;
  functionNodeTypes: string[];
}

export class ParameterAnalyzer {
  private configs: Map<string, LanguageConfig>;

  constructor() {
    const rustParser = new Parser();
    rustParser.setLanguage(Rust);

    const goParser = new Parser();
    goParser.setLanguage(Go);

    const javaParser = new Parser();
    javaParser.setLanguage(Java);

    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);

    const pythonParser = new Parser();
    pythonParser.setLanguage(Python);

    this.configs = new Map<string, LanguageConfig>([
      ["rust", { parser: rustParser, functionNodeTypes: ["function_item"] }],
      [
        "go",
        {
          parser: goParser,
          functionNodeTypes: ["function_declaration", "method_declaration"],
        },
      ],
      [
        "java",
        { parser: javaParser, functionNodeTypes: ["method_declaration"] },
      ],
      [
        "typescript",
        {
          parser: tsParser,
          functionNodeTypes: [
            "function_declaration",
            "method_definition",
            "arrow_function",
            "function_expression",
          ],
        },
      ],
      [
        "python",
        { parser: pythonParser, functionNodeTypes: ["function_definition"] },
      ],
    ]);
  }

  analyze(func: FunctionIR): Issue[] {
    const issues: Issue[] = [];

    let sourceCode: string;
    try {
      sourceCode = fs.readFileSync(func.filePath, "utf-8");
    } catch (err) {
      throw new Error(`Cannot read file '${func.filePath}': ${err}`);
    }

    const language = func.metadata.language;
    const config = this.configs.get(language);

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

      const isUsed = config
        ? this.checkParameterUsageAST(
            config,
            sourceCode,
            func.name,
            param.name
          )
        : this.checkParameterUsageByText(sourceCode, func.lineNumber, param.name);

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

  private checkParameterUsageAST(
    config: LanguageConfig,
    sourceCode: string,
    funcName: string,
    paramName: string
  ): boolean {
    const tree = config.parser.parse(sourceCode);
    return this.searchFunctionNode(
      tree.rootNode,
      funcName,
      paramName,
      sourceCode,
      config.functionNodeTypes
    );
  }

  private searchFunctionNode(
    node: Parser.SyntaxNode,
    funcName: string,
    paramName: string,
    sourceCode: string,
    functionNodeTypes: string[]
  ): boolean {
    if (functionNodeTypes.includes(node.type)) {
      // For arrow functions the name lives on the parent variable_declarator,
      // not on the node itself — skip name check and search the body directly
      // when the body text contains the parameter name.
      const nameNode = node.childForFieldName("name");
      const matchesName =
        nameNode &&
        sourceCode.substring(nameNode.startIndex, nameNode.endIndex) ===
          funcName;

      if (matchesName) {
        const body = node.childForFieldName("body");
        if (body) {
          return this.searchIdentifier(body, paramName, sourceCode);
        }
      }
    }

    // For TypeScript arrow functions assigned to variables: look inside
    // variable_declarator nodes whose name matches funcName
    if (node.type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const valueNode = node.childForFieldName("value");
      if (
        nameNode &&
        sourceCode.substring(nameNode.startIndex, nameNode.endIndex) ===
          funcName &&
        valueNode &&
        (valueNode.type === "arrow_function" ||
          valueNode.type === "function_expression")
      ) {
        const body = valueNode.childForFieldName("body");
        if (body) {
          return this.searchIdentifier(body, paramName, sourceCode);
        }
      }
    }

    for (const child of node.children) {
      if (
        this.searchFunctionNode(
          child,
          funcName,
          paramName,
          sourceCode,
          functionNodeTypes
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Text-based fallback for languages without tree-sitter support (e.g. Zig).
   * Extracts the function body starting at funcLineNumber and checks whether
   * paramName appears as a word boundary match after the first line (signature).
   */
  private checkParameterUsageByText(
    sourceCode: string,
    funcLineNumber: number,
    paramName: string
  ): boolean {
    const MAX_BODY_LINES = 2000;
    const lines = sourceCode.split("\n");
    const funcStartIdx = funcLineNumber - 1;

    let braceCount = 0;
    let inBody = false;
    const bodyLines: string[] = [];

    for (
      let i = funcStartIdx;
      i < lines.length && i < funcStartIdx + MAX_BODY_LINES;
      i++
    ) {
      const line = lines[i];
      for (const char of line) {
        if (char === "{") {
          braceCount++;
          inBody = true;
        }
        if (char === "}") braceCount--;
      }
      if (inBody) bodyLines.push(line);
      if (inBody && braceCount === 0) break;
    }

    // Skip first body line (opening brace / signature continuation) and search the rest
    const bodyText = bodyLines.slice(1).join("\n");
    return new RegExp(`\\b${paramName}\\b`).test(bodyText);
  }

  private searchIdentifier(
    node: Parser.SyntaxNode,
    identifier: string,
    sourceCode: string
  ): boolean {
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

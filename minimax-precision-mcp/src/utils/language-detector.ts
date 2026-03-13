import { RustParser } from "../parsers/rust.js";
import { GoParser } from "../parsers/go.js";
import { TypeScriptParser } from "../parsers/typescript.js";
import { JavaParser } from "../parsers/java.js";
import { PythonParser } from "../parsers/python.js";
import { ZigParser } from "../parsers/zig.js";
import { FunctionIR } from "../types.js";
import * as path from "path";

export class LanguageDetector {
  private rustParser: RustParser;
  private goParser: GoParser;
  private tsParser: TypeScriptParser;
  private javaParser: JavaParser;
  private pythonParser: PythonParser;
  private zigParser: ZigParser;

  constructor() {
    this.rustParser = new RustParser();
    this.goParser = new GoParser();
    this.tsParser = new TypeScriptParser();
    this.javaParser = new JavaParser();
    this.pythonParser = new PythonParser();
    this.zigParser = new ZigParser();
  }

  detectLanguage(filePath: string): string | null {
    const ext = path.extname(filePath);
    const extMap: Record<string, string> = {
      ".rs": "rust",
      ".go": "go",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".java": "java",
      ".py": "python",
      ".zig": "zig",
    };
    return extMap[ext] || null;
  }

  parseFile(filePath: string): FunctionIR[] {
    const lang = this.detectLanguage(filePath);
    if (!lang) return [];

    switch (lang) {
      case "rust":
        return this.rustParser.parseFile(filePath);
      case "go":
        return this.goParser.parseFile(filePath);
      case "typescript":
        return this.tsParser.parseFile(filePath);
      case "java":
        return this.javaParser.parseFile(filePath);
      case "python":
        return this.pythonParser.parseFile(filePath);
      case "zig":
        return this.zigParser.parseFile(filePath);
      default:
        return [];
    }
  }
}

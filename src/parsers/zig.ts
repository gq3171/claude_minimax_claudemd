import { FunctionIR, Parameter } from "../types.js";
import * as fs from "fs";

export class ZigParser {
  parseFile(filePath: string): FunctionIR[] {
    const sourceCode = fs.readFileSync(filePath, "utf-8");
    return this.extractFunctions(sourceCode, filePath);
  }

  private extractFunctions(sourceCode: string, filePath: string): FunctionIR[] {
    const functions: FunctionIR[] = [];
    const lines = sourceCode.split("\n");
    const fnRegex = /^(?:pub\s+)?fn\s+(\w+)\s*\((.*?)\)\s*(.*?)\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(fnRegex);

      if (match) {
        const name = match[1];
        const paramsStr = match[2];
        const returnType = match[3] || "void";
        const parameters = this.parseParameters(paramsStr);
        const body = this.extractBody(lines, i);

        functions.push({
          name,
          filePath,
          lineNumber: i + 1,
          signature: {
            parameters,
            returnType: returnType.trim(),
          },
          body: {
            isEmpty: body.trim() === "",
            hasPlaceholder: /@panic\("not implemented"\)|unreachable/.test(body),
          },
          metadata: {
            language: "zig",
            isAsync: false,
          },
        });
      }
    }

    return functions;
  }

  private parseParameters(paramsStr: string): Parameter[] {
    const params: Parameter[] = [];
    if (!paramsStr.trim()) return params;

    const paramParts = paramsStr.split(",");
    for (const part of paramParts) {
      const match = part.trim().match(/(\w+)\s*:\s*(.+)/);
      if (match) {
        params.push({
          name: match[1],
          type: match[2].trim(),
          isUsed: false,
          usageLocations: [],
        });
      }
    }

    return params;
  }

  private extractBody(lines: string[], startLine: number): string {
    let braceCount = 0;
    let body = "";
    let started = false;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === "{") {
          braceCount++;
          started = true;
        }
        if (char === "}") braceCount--;
      }

      if (started) body += line + "\n";
      if (started && braceCount === 0) break;
    }

    return body;
  }
}

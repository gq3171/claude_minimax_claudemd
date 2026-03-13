import { FunctionIR, Issue } from "../types.js";
import * as fs from "fs";

export class DataFlowAnalyzer {
  analyzeFile(filePath: string, functions: FunctionIR[]): Issue[] {
    const issues: Issue[] = [];
    const sourceCode = fs.readFileSync(filePath, "utf-8");

    for (const func of functions) {
      const constructedObjects = this.findConstructedObjects(func, sourceCode);

      for (const obj of constructedObjects) {
        const isUsed = this.isObjectUsed(obj, func, sourceCode);
        if (!isUsed) {
          issues.push({
            type: "dead_code",
            severity: "error",
            location: {
              file: func.filePath,
              line: func.lineNumber,
              column: 0,
            },
            message: `对象 '${obj}' 被构造但未使用`,
            details: { objectName: obj, functionName: func.name },
          });
        }
      }
    }

    return issues;
  }

  private findConstructedObjects(func: FunctionIR, sourceCode: string): string[] {
    const objects: string[] = [];
    const lines = sourceCode.split("\n");

    if (func.lineNumber >= lines.length) return objects;

    const funcStartLine = func.lineNumber - 1;
    let braceCount = 0;
    let inFunction = false;

    for (let i = funcStartLine; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("{")) {
        braceCount++;
        inFunction = true;
      }
      if (line.includes("}")) {
        braceCount--;
        if (braceCount === 0 && inFunction) break;
      }

      if (inFunction) {
        const letMatch = line.match(/let\s+(\w+)\s*=/);
        if (letMatch) objects.push(letMatch[1]);

        const varMatch = line.match(/(?:var|const)\s+(\w+)\s*=/);
        if (varMatch) objects.push(varMatch[1]);
      }
    }

    return objects;
  }

  private isObjectUsed(objName: string, func: FunctionIR, sourceCode: string): boolean {
    const lines = sourceCode.split("\n");
    const funcStartLine = func.lineNumber - 1;
    let braceCount = 0;
    let inFunction = false;
    let foundDeclaration = false;
    let usageCount = 0;

    for (let i = funcStartLine; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("{")) {
        braceCount++;
        inFunction = true;
      }
      if (line.includes("}")) {
        braceCount--;
        if (braceCount === 0 && inFunction) break;
      }

      if (inFunction) {
        if (line.includes(`let ${objName}`) || line.includes(`const ${objName}`) || line.includes(`var ${objName}`)) {
          foundDeclaration = true;
          continue;
        }

        if (foundDeclaration) {
          const regex = new RegExp(`\\b${objName}\\b`, "g");
          const matches = line.match(regex);
          if (matches) usageCount += matches.length;
        }
      }
    }

    return usageCount > 1;
  }
}

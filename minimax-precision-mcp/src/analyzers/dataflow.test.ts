import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DataFlowAnalyzer } from "./dataflow.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FunctionIR } from "../types.js";

function makeFuncIR(
  name: string,
  lineNumber: number,
  filePath: string
): FunctionIR {
  return {
    name,
    filePath,
    lineNumber,
    signature: { parameters: [], returnType: "()" },
    body: { isEmpty: false, hasPlaceholder: false },
    metadata: { language: "rust", isAsync: false },
  };
}

describe("DataFlowAnalyzer", () => {
  const analyzer = new DataFlowAnalyzer();
  let tmpDir: string;
  let tmpFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dataflow-test-"));
    tmpFile = path.join(tmpDir, "test.rs");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("detects constructed-but-never-used object", () => {
    const code = `fn example() {\n  let unused = build_ctx();\n}\n`;
    fs.writeFileSync(tmpFile, code, "utf-8");
    const funcs = [makeFuncIR("example", 1, tmpFile)];
    const issues = analyzer.analyzeFile(tmpFile, funcs);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].details.objectName).toBe("unused");
  });

  it("does not flag variables that are used after declaration", () => {
    const code = `fn example() {\n  let ctx = build_ctx();\n  process(ctx);\n}\n`;
    fs.writeFileSync(tmpFile, code, "utf-8");
    const funcs = [makeFuncIR("example", 1, tmpFile)];
    const issues = analyzer.analyzeFile(tmpFile, funcs);
    // ctx is referenced in process(ctx), so should not be flagged
    const ctxIssues = issues.filter(
      (i) => i.details.objectName === "ctx"
    );
    expect(ctxIssues.length).toBe(0);
  });

  it("throws on unreadable file", () => {
    const funcs = [makeFuncIR("example", 1, "/nonexistent/path/file.rs")];
    expect(() =>
      analyzer.analyzeFile("/nonexistent/path/file.rs", funcs)
    ).toThrow("Cannot read file");
  });
});

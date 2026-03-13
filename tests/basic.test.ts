import { describe, it, expect } from "vitest";
import { RustParser } from "../src/parsers/rust.js";
import { PlaceholderAnalyzer } from "../src/analyzers/placeholder.js";
import { ParameterAnalyzer } from "../src/analyzers/parameter.js";
import { PromptGenerator } from "../src/prompts/generator.js";
import * as fs from "fs";
import * as path from "path";

describe("RustParser", () => {
  it("should parse a simple function", () => {
    const testFile = path.join(__dirname, "fixtures", "simple.rs");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(
      testFile,
      `fn add(a: i32, b: i32) -> i32 {
    a + b
}`
    );

    const parser = new RustParser();
    const functions = parser.parseFile(testFile);

    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe("add");
    expect(functions[0].signature.parameters).toHaveLength(2);
    expect(functions[0].signature.parameters[0].name).toBe("a");
    expect(functions[0].signature.parameters[1].name).toBe("b");

    fs.unlinkSync(testFile);
  });
});

describe("PlaceholderAnalyzer", () => {
  it("should detect empty function", () => {
    const analyzer = new PlaceholderAnalyzer();
    const func = {
      name: "test",
      filePath: "test.rs",
      lineNumber: 1,
      signature: { parameters: [], returnType: "()" },
      body: { isEmpty: true, hasPlaceholder: false },
      metadata: { language: "rust", isAsync: false },
    };

    const issues = analyzer.analyze(func);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("empty_function");
  });
});

describe("PromptGenerator", () => {
  it("should generate prompt for function with issues", () => {
    const generator = new PromptGenerator();
    const report = {
      function: {
        name: "process",
        filePath: "test.rs",
        lineNumber: 10,
        signature: {
          parameters: [{ name: "data", type: "String", isUsed: false, usageLocations: [] }],
          returnType: "Result<()>",
        },
        body: { isEmpty: false, hasPlaceholder: false },
        metadata: { language: "rust", isAsync: false },
      },
      issues: [
        {
          type: "unused_parameter" as const,
          severity: "error" as const,
          location: { file: "test.rs", line: 10, column: 0 },
          message: "参数 'data' 未被使用",
          details: { parameterName: "data" },
        },
      ],
      context: { callers: [], callees: [] },
    };

    const prompt = generator.generate(report);
    expect(prompt.prompt).toContain("process");
    expect(prompt.prompt).toContain("data");
    expect(prompt.checkpoints.length).toBeGreaterThan(0);
  });
});

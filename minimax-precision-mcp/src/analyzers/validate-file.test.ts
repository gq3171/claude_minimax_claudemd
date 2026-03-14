import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MinimaxPrecisionServer } from "../server.js";

// Access the private runValidateFile method for testing via a subclass
class TestableServer extends MinimaxPrecisionServer {
  public validateFile(filePath: string) {
    // @ts-expect-error accessing private method for testing
    return this.runValidateFile(filePath);
  }
}

describe("validate_file gate tool", () => {
  const server = new TestableServer();
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-file-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function write(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content, "utf-8");
    return p;
  }

  it("passes a clean Rust file", () => {
    const p = write(
      "clean.rs",
      `pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n`
    );
    const result = server.validateFile(p);
    expect(result.passed).toBe(true);
    expect(result.blockers.length).toBe(0);
    expect(result.verdict).toContain("✅ PASSED");
    expect(result.language).toBe("rust");
    expect(result.functions_checked).toBe(1);
  });

  it("blocks on error handling antipattern", () => {
    const p = write(
      "bad_error.rs",
      `pub fn get_name() -> String {\n    let s = result.unwrap_or_default();\n    s\n}\n`
    );
    const result = server.validateFile(p);
    expect(result.passed).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.by_category.error_handling).toBeGreaterThan(0);
    expect(result.verdict).toContain("❌ BLOCKED");
  });

  it("blocks on empty function body", () => {
    const p = write(
      "empty_fn.rs",
      `pub fn process(data: Vec<u8>) {\n}\n`
    );
    const result = server.validateFile(p);
    expect(result.passed).toBe(false);
    const placeholderBlockers = result.blockers.filter(
      (b) => b.category === "placeholder"
    );
    expect(placeholderBlockers.length).toBeGreaterThan(0);
  });

  it("reports dead code as warning, does not block", () => {
    const p = write(
      "dead_code.rs",
      // unused_helper is public but never called — warning, not error
      `pub fn unused_helper() -> i32 { 42 }\npub fn main() {}\n`
    );
    const result = server.validateFile(p);
    // dead_code is warning severity → should not block
    expect(result.by_category.dead_code).toBeGreaterThan(0);
    const deadBlockers = result.blockers.filter((b) => b.category === "dead_code");
    expect(deadBlockers.length).toBe(0);
    const deadWarnings = result.warnings.filter((b) => b.category === "dead_code");
    expect(deadWarnings.length).toBeGreaterThan(0);
  });

  it("returns language and function count correctly", () => {
    const p = write(
      "multi.rs",
      `pub fn a() -> i32 { 1 }\npub fn b() -> i32 { 2 }\npub fn c() -> i32 { 3 }\n`
    );
    const result = server.validateFile(p);
    expect(result.language).toBe("rust");
    expect(result.functions_checked).toBe(3);
  });

  it("throws on non-existent file", () => {
    expect(() =>
      server.validateFile("/nonexistent/file.rs")
    ).toThrow();
  });
});

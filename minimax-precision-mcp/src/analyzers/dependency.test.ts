import { describe, it, expect } from "vitest";
import { DependencyAnalyzer } from "./dependency.js";

describe("DependencyAnalyzer", () => {
  const analyzer = new DependencyAnalyzer();

  it("detects function called but not defined (Rust)", () => {
    const code = `
fn main() {
  let x = compute_value();
}
`;
    const issues = analyzer.analyze(code, "test.rs");
    expect(issues.some((i) => i.message.includes("compute_value"))).toBe(true);
    expect(issues[0].type).toBe("missing_dependency");
  });

  it("does not flag locally defined functions", () => {
    const code = `
fn helper() {}
fn main() {
  helper();
}
`;
    const issues = analyzer.analyze(code, "test.rs");
    const helperIssue = issues.find((i) => i.message.includes("helper"));
    expect(helperIssue).toBeUndefined();
  });

  it("does not flag Rust standard library builtins", () => {
    const code = `
fn main() {
  println!("hello");
  let v = vec![1, 2, 3];
  let s = format!("{}", v.len());
}
`;
    // Note: macro calls like println! won't be captured as `println(` calls
    // but format, vec etc. without `!` would be checked
    const issues = analyzer.analyze(code, "test.rs");
    // Should not flag 'format', 'vec', 'println' as missing
    const stdIssues = issues.filter((i) =>
      ["format", "vec", "println"].some((fn) => i.message.includes(`'${fn}'`))
    );
    expect(stdIssues.length).toBe(0);
  });

  it("does not flag TypeScript standard builtins", () => {
    const code = `
function main() {
  const arr = Array.from([1, 2, 3]);
  console.log(arr.length);
  const n = parseInt("42");
}
`;
    const issues = analyzer.analyze(code, "test.ts");
    const stdIssues = issues.filter((i) =>
      ["parseInt", "Array", "console"].some((fn) =>
        i.message.includes(`'${fn}'`)
      )
    );
    expect(stdIssues.length).toBe(0);
  });

  it("reports location at first call site", () => {
    const code = `fn foo() {}\nfn bar() {\n  let x = unknown_func();\n}\n`;
    const issues = analyzer.analyze(code, "test.rs");
    const issue = issues.find((i) => i.message.includes("unknown_func"));
    expect(issue).toBeDefined();
    expect(issue!.location.line).toBe(3);
  });
});

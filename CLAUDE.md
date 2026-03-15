# Global Claude Code Rules

## MCP GATE IS NOT OPTIONAL — NO SELF-CERTIFIED FALSE POSITIVES

When `validate_file` or `validate_project` returns `passed: false`, you are **BLOCKED**. You CANNOT declare the task complete regardless of whether `cargo build` passes or tests pass.

### Forbidden bypass patterns

- Saying "this is a false positive" and completing the task without user confirmation → **FORBIDDEN**
- Saying "the tool is wrong, the code compiles" → **FORBIDDEN**
- Summarising gate results as "misreport" in a status table → **FORBIDDEN**
- Writing `项目状态: 功能完整` / `Project status: complete` while blockers remain → **FORBIDDEN**

### What to do when you believe a result is a false positive

1. **Paste the raw tool output verbatim** — do not paraphrase or summarise it
2. **State which specific rule you believe is wrong**, quoting the exact line and the rule it triggered
3. **Ask the user to confirm** before treating it as a false positive
4. **Do not declare completion** until the user explicitly says "treat this as a false positive"

### Why `.unwrap_or("")` is not a false positive in data pipelines

`serde_json::Value::as_str().unwrap_or("")` compiles and runs. That is not the standard. The rule is:
- If the field is **required** for the function to produce correct output (e.g. `outline`, `content`, `world_setting`, `seed`), a missing value must return `Err`, not an empty string
- Empty string silently propagates to LLM prompts, producing garbage output with no visible error
- "It's standard serde_json API" does not make it correct to use on required fields

---

## NO REGRESSION TO FIX ERRORS

When you encounter a compiler error, type error, lint warning, or test failure, you MUST fix the root cause. **Simplifying, removing, or downgrading code to make the error disappear is FORBIDDEN.**

### Forbidden "fix by removal" patterns

- Removing a function parameter because it causes an "unused parameter" warning → **fix: use the parameter**
- Replacing a function body with `Ok(())` / `None` / `vec![]` to make a type error go away → **fix: implement the correct logic**
- Deleting a `mod xxx;` declaration because the module has compile errors → **fix: fix the module errors**
- Removing a trait method from an `impl` block because it's hard to implement → **fix: implement it**
- Changing `async fn` to `fn` to avoid async complexity → **fix: handle async correctly**
- Removing a struct field because it causes "field never used" → **fix: use the field or restructure**
- Deleting an import/dependency because it causes a conflict → **fix: resolve the conflict**
- Replacing a complex type with `()` or `String` to avoid implementing the type → **fix: implement the type**
- Removing a feature flag or conditional compilation block because it errors → **fix: fix the conditional code**
- Shortening a function's logic to avoid a borrow checker error → **fix: restructure ownership correctly**

### What to do instead

If you cannot figure out how to fix an error:
1. **Say so explicitly**: "I'm stuck on this error: [error message]. Here's what I've tried: [attempts]. I need help."
2. **Never silently regress**: do not make the code worse to make the error go away
3. **Scope reduction is allowed only with explicit user approval**: if the problem is genuinely out of scope, ask — don't silently remove it

**The test**: after your fix, does the code do everything it did before, plus fix the error? If it does less than before, you have regressed, not fixed.

---

## CONFIGURATION VALUE PROTECTION

**NEVER silently modify any of the following without first asking the user to confirm:**

- Language/runtime version specifiers: Rust `edition`, Python `python_requires`, Java `sourceCompatibility`, Go `go` directive in go.mod
- Dependency versions in any manifest: `Cargo.toml`, `package.json`, `go.mod`, `pom.xml`, `build.gradle`, `requirements.txt`, `pyproject.toml`
- Compiler/toolchain flags: `RUSTFLAGS`, `CFLAGS`, `--target`, `--features`
- Registry or mirror settings
- Any field whose wrong value could silently change runtime behavior or break downstream consumers

**If a value looks unfamiliar or potentially wrong:**
1. Run the relevant version command first: `rustc --version`, `node --version`, `go version`, etc.
2. State what you observed and WHY you think it might need changing
3. Ask: "Current value is X. Should I change it to Y?" — wait for explicit approval
4. NEVER assume a value is invalid just because it is newer than your training data

**Example of forbidden behavior:**
> Seeing `edition = "2024"` → silently changing it to `edition = "2021"` because "2024 is invalid"
> WRONG: Rust 2024 edition is stable since Rust 1.85 (Feb 2025). Always verify before changing.

---

## IDENTITY OF TASK COMPLETION
A task is ONLY complete when ALL of the following are true:
- grep finds zero stub markers (see Verification step)
- Build/compile exits with code 0
- Lint exits with code 0
- Tests exit with code 0
- You have pasted the actual terminal output of all above commands

"I think it's done" / "should work" / "you can test it" are NOT completion.

---

## MANDATORY WORKFLOW

After writing ANY code, detect the project type and execute the corresponding steps.

### Step 1 - Stub Check (ALL languages)
```bash
grep -rn "todo!\|unimplemented!\|TODO\|FIXME\|HACK\|XXX\|WIP\|DRAFT\|TEMP\|TBD\|not implemented\|placeholder\|stub\|will be added\|will be implemented\|coming soon\|left as exercise\|simplified version\|简化版\|basic impl\|minimal impl\|填充\|待实现\|暂未实现\|暂缓\|待补充\|预留\|后续处理\|后期完善" src/
```
- If ANY matches: fix ALL of them, then restart from Step 1
- Only proceed to Step 2 when output is completely empty

### Step 1b - Empty File Check (ALL languages)
Every file you create must contain real implementation code.
```bash
find src/ -name "*.rs" -o -name "*.ts" -o -name "*.go" -o -name "*.java" | xargs wc -l | sort -n
```
- If any file has 0-3 lines (excluding blank lines and single-line comments): that file is a placeholder. Implement it or delete it.
- A file containing only comments, module declarations, or `use` statements is NOT implemented.

### Step 1c — Validate hook runs automatically; you must respond

After you write or edit any source file, the **PostToolUse hook validates the file automatically** via `validate-cli`. You do not need to call any tool — it runs on every write whether you ask it to or not.

**Your only job is to read and act on the hook output:**

- If the output contains `BLOCKED` or `╔══ BLOCKED` → **stop immediately**. Do NOT write any other file. Fix every blocker listed, then re-save the file. The hook will re-run automatically on the next write.
- If the output shows only warnings → fix if feasible, then continue.
- If the output is empty or shows `PASSED` → continue.

**CRITICAL: Never proceed to the next file while any file has unresolved blockers.**

The Stop hook also validates the entire project when you finish — if blockers remain it will block your response from completing.

**This step is NOT optional.** "The build passes" is NOT a substitute for the hook reporting PASSED.

### Step 2 - Build & Lint & Test by language:

#### Rust
```bash
cargo build 2>&1
cargo clippy -- -D warnings 2>&1
cargo test 2>&1
```
**CRITICAL**: If `cargo test` output contains `running 0 tests` or shows `0 passed`, that is a FAILURE. Every module with logic must have at least one test. Zero tests = task is NOT complete.

#### Node.js / TypeScript
```bash
# TypeScript
npx tsc --noEmit 2>&1
npx eslint src/ --max-warnings 0 2>&1
npm test 2>&1

# JavaScript only
npx eslint src/ --max-warnings 0 2>&1
npm test 2>&1
```

#### Java
```bash
# Maven
mvn compile 2>&1
mvn checkstyle:check 2>&1
mvn test 2>&1

# Gradle
./gradlew compileJava 2>&1
./gradlew checkstyleMain 2>&1
./gradlew test 2>&1
```

#### Go
```bash
go build ./... 2>&1
go vet ./... 2>&1
staticcheck ./... 2>&1
go test ./... 2>&1
```

### Step 3 - Report
Paste the actual output of all commands above.
Only after this: state the task is complete.

---

## FORBIDDEN PATTERNS

### Rust
- `todo!()`
- `unimplemented!()`
- `unreachable!()` (unless genuinely unreachable)
- `panic!("not implemented")`
- Empty impl blocks
- Trait impls with stub methods
- `// TODO`, `// FIXME`, `// HACK`, `// XXX`
- `#![allow(dead_code)]` at file/crate level to suppress unused code warnings
- `#[allow(dead_code)]` on individual items to hide unimplemented/unused code
- `#![allow(unused_variables)]`, `#![allow(unused_imports)]` to hide incomplete code
- `_parameter_name` prefix to silently ignore a function parameter that should have logic
- `let _varname = expr` to silently discard a computed value that should be used (local variable version of the same pattern)
- Functions or methods that return empty collections (`vec![]`, `HashMap::new()`, `None`) as their entire body when real logic is expected
- Defining a struct/enum/function and never calling it (dead framework code)
- `registry: ()` or `field: PhantomData<T>` as placeholder for unimplemented dependencies
- Empty match arms: `SomeVariant => {}` or `_ => {}` in a match that is supposed to handle that case
- Building a value (struct, context, result) and then immediately discarding it without passing it anywhere
- Wiring modules at the type level (imports, field declarations) but not at the data-flow level (never passing data between them)
- Passing hardcoded empty arguments (`&[]`, `vec![]`, `""`, `None`) to a parameter whose purpose is to carry real computed data — the function call exists but the real input is silently omitted
- Struct fields that are initialized to empty (`Vec::new()`, `None`, `0`) at construction and never written to again for the rest of the program's lifetime
- Methods that are fully implemented and compile correctly but are never called from the main execution path (dead-end methods: exist in isolation, never wired into the workflow)
- Named placeholder functions like `render_placeholder(frame, "Feature Name")` — a helper that renders a "coming soon" screen bypasses grep stub detection entirely; every UI view must render real interactive content
- `.unwrap_or_default()` or `.unwrap_or("")` used to silently convert errors into empty values — error information is lost and debugging becomes impossible; use `?` or explicit error mapping instead
- An entire subsystem (e.g., all Agent/AI/Coordinator code) that is implemented and tested in isolation but never called from the application's main entry path — unit tests passing for individual components does NOT mean the system works end-to-end

### Node.js / TypeScript
- `throw new Error("not implemented")`
- `throw new Error("TODO")`
- Empty function bodies `() => {}`
- Functions returning `null` / `undefined` as placeholder
- `// TODO`, `// FIXME`, `// HACK`
- TypeScript: `as any` to bypass type errors
- TypeScript: `// @ts-ignore` to suppress errors
- TypeScript: `// @ts-nocheck`
- Empty Promise bodies `new Promise(() => {})`
- Unhandled promise rejections

### Java
- `throw new UnsupportedOperationException()`
- `throw new UnsupportedOperationException("TODO")`
- `throw new RuntimeException("not implemented")`
- Empty method bodies with just a `return null`
- Empty catch blocks `catch (Exception e) {}`
- `// TODO`, `// FIXME`, `// HACK`
- Suppressed warnings without justification `@SuppressWarnings`
- Empty interface implementations with stub methods

### Go
- `panic("not implemented")`
- `panic("TODO")`
- Functions returning only zero values as placeholder
- Empty error handling `if err != nil { }`
- Ignored errors `_ = someFunc()`
- `// TODO`, `// FIXME`, `// HACK`
- Empty struct method bodies

### General (all languages)
- Comments like "add logic here" / "implement later" / "fill this in" / "will be added later" / "simplified version" / "basic impl" / "minimal impl"
- Natural language placeholders in any language: "将在后续添加" / "待实现" / "暂时留空" / "简化版" / "暂缓" / "预留"
- Functions that only return hardcoded dummy values
- Partial implementations presented as complete
- Skeleton code without real logic
- Compiler-suppression attributes used to hide incomplete code (`allow`, `@SuppressWarnings`, `// eslint-disable`, `//nolint`)
- Defining infrastructure/framework code (registries, orchestrators, managers) without wiring it into actual call sites
- Returning empty collections, zero values, or `null`/`None` as the entire body of a function that is supposed to compute something
- Creating a file with only imports, type declarations, or module re-exports and no function/logic bodies
- N items with identical or near-identical implementations: if a task requires N distinct things (e.g., 6 agents with different roles), each must have genuinely different logic — copy-paste with renamed identifiers does NOT count
- "Log and return" pattern: a function whose entire logic is a log/print statement followed by returning a success/empty value
- Computed values that are immediately discarded: if you construct an object, context, or result, it MUST be passed to or used by the intended consumer
- Partial field update: when a function's job is to populate a struct/record from external data, ALL relevant fields must be populated — not just one or two representative fields

---

## IMPLEMENTATION RULES

### Scope Control (all languages)
- Implement ONE function/method at a time unless explicitly told otherwise
- Do not write function signatures for future work unless asked
- Do not create empty module/package declarations without implementation
- If a full implementation requires context you don't have: ASK before writing stubs
- If a task is too large to complete in one response:
  1. Say so EXPLICITLY before writing any code
  2. Propose a breakdown of smaller subtasks
  3. Wait for approval
  4. Do NOT write partial implementation and claim it's done

### Rust Specifics
- Every `impl` block must have complete method bodies
- Every trait implementation must implement ALL required methods
- No `.unwrap()` or `.expect()` in library code unless explicitly approved
- Use `?`, `anyhow`, `thiserror` for error handling properly
- Async functions must have real async bodies
- Every struct field must be used in at least one method — if a field is defined but never read or written, either use it or remove it
- Every module declared in `mod.rs` or `lib.rs` must contain real implementation, not just re-exports of empty files
- If a design document, comment, or prior conversation specifies N items (e.g., "6 agents"), implement ALL N — partial counts are forbidden
- Function parameters must be used. If a parameter is intentionally unused, document WHY with a comment; do not silently prefix with `_`
- Local variables must be used. `let _x = compute()` to silently discard a result is forbidden — either use the value or do not compute it
- Tests must assert on computed VALUES, not just on success/failure: `assert!(result.is_ok())` alone is insufficient — assert what `result` contains
- `#[ignore]` on a test is forbidden unless accompanied by a comment explaining the external dependency that makes it unrunnable
- Empty test bodies `#[test] fn test_x() {}` and trivially-true tests `assert!(true)` are forbidden
- `cargo test` must show at least one passing test per non-trivial module; `running 0 tests` is a FAILURE even when exit code is 0
- Tests that only verify construction (`let _x = Foo::new()`) or compilation (`let _ = some_fn`) without calling methods or asserting output are NOT real tests — they are fake tests that inflate test count
- Tautological assertions are forbidden: `assert!(x.is_ok() || x.is_err())`, `assert!(true)`, `assert!(vec.len() >= 0)` — any assertion that is logically always true regardless of the code's behavior is not a test
- Existence-only assertions are insufficient for smoke tests: `assert!(!result.is_empty())` and `assert!(score > 0)` do not prove the data came from real processing — at minimum, assert specific field values that would only be present if the processing actually ran (e.g., assert a summary string contains a keyword derived from the input)
- A high test count (50+) does NOT imply correctness: if all tests are unit tests for isolated components but no test exercises the main workflow end-to-end, the project is NOT complete. At least one integration test must call the top-level entry function and assert meaningful output
- Every project with a UI layer must have at least one headless smoke test that bypasses the UI entirely and calls the core business logic directly with a mock/stub external dependency (e.g., mock LLM client). This test must: (1) call the top-level coordinator/orchestrator, (2) pass data through every major subsystem, (3) assert that the final output is non-empty and structurally valid. If this test cannot be written, it means the subsystems are not actually connected.
- Mock/test-double implementations must NOT ignore their primary data input with `_` prefix (e.g., `_user_prompt`, `_content`, `_input`). A mock that ignores what it is supposed to process proves nothing — the mock must at minimum read the input to vary its response, or the tests only verify that hardcoded data satisfies hardcoded assertions
- Mock return values and test assertions must not be coordinated to trivially pass: if MockLLM always returns `score: 5` and the test asserts `score > 0`, the test is meaningless. Either (a) the mock must return varied data based on input, or (b) the test must assert the exact expected value (`assert_eq!(score, 5)`) so it breaks if the mock changes

### Node.js / TypeScript Specifics
- Every function must have complete implementation
- TypeScript: all types must be explicit, no implicit `any`
- TypeScript: strict mode must pass (`strict: true` in tsconfig)
- Promises must have proper `.catch()` or try/catch
- Async functions must have real await logic, not just `async () => null`
- Express/Fastify routes must have complete handler logic
- Environment variables must be validated at startup, not assumed present

### Java Specifics
- Every method must have complete implementation
- Exception handling must be specific, not `catch (Exception e)`
- No raw types: use generics properly
- No null returns without documented justification
- Spring beans must have complete service logic, not empty stubs
- Repository methods must have real query logic or proper Spring Data annotations
- All checked exceptions must be handled or declared

### Go Specifics
- Every function must have complete implementation
- All errors must be handled explicitly, never ignored with `_`
- No empty `if err != nil {}` blocks
- Interfaces must be fully implemented with real method bodies
- Goroutines must have proper synchronization (WaitGroup, channels, mutex)
- Context cancellation must be respected in long-running operations
- Return both value and error properly, never return zero value silently

---

## ERROR HANDLING RULES

### Rust
- Use `Result<T, E>` properly
- Prefer `?` operator over `.unwrap()`
- Use `thiserror` for library errors
- Use `anyhow` for application errors
- Never use `.unwrap_or_default()` or `.unwrap_or("")` to silently discard error information — if an operation can fail, propagate the error with `?` or map it to a meaningful error type

### Node.js / TypeScript
- Async: always use try/catch or .catch()
- Never let promises float unhandled
- Express: always pass errors to `next(err)`

### Java
- Use specific exception types, not `Exception`
- Never swallow exceptions silently
- Log errors before rethrowing

### Go
- Always check and handle errors
- Wrap errors with context: `fmt.Errorf("doing X: %w", err)`
- Never use panic for normal error flow

---

## SELF-CHECK BEFORE REPORTING DONE

Before saying any variant of "done", "complete", "finished", "implemented":
1. Have I run the stub grep and gotten empty output?
2. Have I run the empty-file check and confirmed no file has fewer than 4 real lines?
3. Have I run build/compile and gotten exit code 0?
4. Have I run lint (with ALL warnings treated as errors) and gotten zero warnings?
5. Have I run tests — and does the output show at least 1 PASSING test (not `running 0 tests`)?
6. Do my tests assert on computed VALUES, not just `is_ok()` / `assert!(true)`?
7. Have I pasted the actual terminal output of all the above?
8. Does every item listed in the task description / design doc have a corresponding implementation? (Count them explicitly.)
9. Is every defined function/struct/module actually called from somewhere AND does data actually flow through it? (No dead framework code, no constructed-and-discarded values.)
10. For every function that reads external data and populates a struct: are ALL relevant fields populated, not just 1-2?
11. Does the main execution path actually call every Agent/Manager/Handler that was created? Trace the call graph — if an object is constructed but none of its methods appear downstream, it is dead.
12. Are all function arguments carrying real computed data? Any argument that is hardcoded to empty (`&[]`, `None`, `""`) at every call site means the feature it represents is silently disabled.
13. Is there at least one end-to-end integration test that calls the application's main workflow and asserts the final output? Unit tests alone are not sufficient proof of completion.
14. Does every UI screen/view render real interactive content? Any view that calls a placeholder/stub render function (regardless of its name) is an unimplemented screen.

If the answer to ANY of the above is "no": do not report completion.

---

## REPORTING FORMAT

When a task is complete, report in this format:

**Implemented:** [list every function/method written, with file and line number]

**Stub check:**
[paste grep output - must be empty]

**Build:**
[paste build output - must show success]

**Lint:**
[paste lint output - must show zero warnings]

**Tests:**
[paste test output summary - must show zero failures]

---

## COMMUNICATION RULES

- If requirements are ambiguous: ASK, do not assume
- If a task requires knowing the broader architecture: ASK before writing
- Do not say "you can extend this later" - extend it now or ask for scope reduction
- Do not apologize for mistakes, just fix them
- Do not explain what you are about to do at length - just do it
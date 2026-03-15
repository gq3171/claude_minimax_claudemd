Run a full MCP validation pass on the current project. Follow these steps exactly:

1. Call `validate_project` with the current project root directory (the directory containing Cargo.toml / package.json / go.mod).

2. If `passed: false`:
   - For each item in `blockers[]`: fix the issue immediately, then call `validate_file` on the affected file to confirm it passes.
   - After fixing all blockers, call `validate_project` again.
   - Repeat until `validate_project` returns `passed: true`.

3. Call `validate_file` on every source file you have written or modified in this session.
   - If any file returns `passed: false`: fix all items in `blockers[]`, then re-call `validate_file` until it returns `passed: true`.

4. Report final status: list every file checked, its result, and confirm both `validate_file` (all files) and `validate_project` return `passed: true`.

Do NOT report completion until all gates pass. "cargo build passes" is NOT a substitute for `validate_file`/`validate_project` returning `passed: true`.

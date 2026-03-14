# minimax-precision-mcp

Static analysis MCP server for Claude Code CLI. Provides function-level code quality gates that catch issues compile/lint tools miss — empty bodies, unused parameters, error-handling antipatterns, dead code, and constructed-but-discarded values.

Designed as a strict enforcement layer for AI-generated code (MiniMax M2.5, Claude, etc.).

---

## Tools

| Tool | Description |
|------|-------------|
| `validate_file` | **Gate tool.** Runs all checks on a file, returns `passed: true/false` with `blockers[]` and `warnings[]`. The primary enforcement point. |
| `analyze_function` | Analyzes a single function and generates a corrective implementation prompt. |
| `scan_placeholders` | Scans a directory for placeholder/stub code across all supported files. |
| `trace_data_flow` | Detects objects that are constructed but never passed to or used by anything. |
| `validate_implementation` | Validates a single function's completeness and returns a 0–10 score. |
| `check_error_handling` | Detects `.unwrap_or_default()`, `.unwrap_or("")`, and similar silent-failure patterns. |
| `detect_dead_code` | Finds public functions that are defined but never called. |
| `check_dependencies` | Finds functions that are called but not defined in the file. |

**Supported languages:** Rust, Go, Java, TypeScript, JavaScript, Python, Zig

---

## How `validate_file` works

```
validate_file("src/foo.rs")
→ {
    passed: false,
    blockers: [
      { category: "placeholder", severity: "critical", message: "函数 'process' 是空函数体" },
      { category: "error_handling", severity: "error", message: "Using .unwrap_or_default()" }
    ],
    warnings: [...],
    by_category: { placeholders: 1, error_handling: 1, dead_code: 0, ... },
    verdict: "❌ BLOCKED — src/foo.rs: 2 blocker(s) must be fixed before proceeding"
  }
```

`passed: false` means the model is **blocked** — fix every item in `blockers[]` and re-call until `passed: true`.

**Severity levels:**

| Category | Severity | Blocks? |
|----------|----------|---------|
| Empty function body / placeholder | critical | ✅ Yes |
| Unused parameter / `_` prefix | error | ✅ Yes |
| `.unwrap_or_default()` / `.unwrap_or("")` | error | ✅ Yes |
| Constructed-but-unused object | error | ✅ Yes |
| Dead code (public fn never called) | warning | ⚠ No |
| Missing dependency | warning | ⚠ No |

---

## Installation

### Prerequisites

- Node.js 18+
- Claude Code CLI

### 1. Clone and build

```bash
git clone https://github.com/gq3171/claude_minimax_claudemd.git
cd claude_minimax_claudemd/minimax-precision-mcp
npm install
npm run build
```

### 2. Register with Claude Code

```bash
claude mcp add --scope user minimax-precision-mcp node "$(pwd)/dist/index.js"
```

Verify:

```bash
claude mcp list
# minimax-precision-mcp: node /path/to/dist/index.js - ✓ Connected
```

### 3. Copy global CLAUDE.md

```bash
cp ../CLAUDE.md ~/.claude/CLAUDE.md
```

### 4. Add the PostToolUse hook

Create or update `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const args=JSON.parse(process.env.CLAUDE_TOOL_ARGS||'{}');const fp=args.file_path||args.path||'';const exts=['.rs','.ts','.tsx','.go','.java','.py','.zig','.js'];if(fp&&exts.includes(path.extname(fp))){process.stdout.write('[MCP GATE] File modified: '+fp+'\\n>>> Call validate_file(\\\"'+fp+'\\\") now\\n>>> Fix all blockers, repeat until passed:true\\n');}\"",
            "statusMessage": "MCP gate check..."
          }
        ]
      }
    ]
  }
}
```

The hook fires after every `Write`/`Edit` on a source file and reminds Claude to call `validate_file` before continuing.

---

## Enforcement workflow

```
AI generates code
      ↓  Write/Edit tool
[PostToolUse hook fires]
  → "[MCP GATE] Call validate_file(...) now"
      ↓
[Claude calls validate_file]
  ├─ passed: true  → proceed to build/lint/test
  └─ passed: false → fix all blockers → re-call → loop
      ↓
build / lint / test
```

The `CLAUDE.md` Step 1c encodes this as a mandatory, non-skippable rule:

> After writing or editing ANY source file, call `validate_file`. If `passed: false`, you are BLOCKED. Fix every item in `blockers[]`, then re-call until `passed: true`.

---

## Development

```bash
cd minimax-precision-mcp
npm run build   # compile TypeScript
npm test        # vitest (22 tests)
npm run lint    # eslint --max-warnings 0
```

---

## License

MIT

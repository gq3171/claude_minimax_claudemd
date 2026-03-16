# minimax-precision-mcp

[中文](#中文说明) | [English](#english)

---

## 中文说明

**minimax-precision-mcp** 是一个为 Claude Code CLI 设计的静态分析 MCP 服务，在编译器和 lint 工具之前拦截 AI 生成代码中的常见质量问题。

**三层全自动执行，无需手动干预：**
- **PostToolUse Hook** — 每次 Write/Edit 后立即检查，发现 blocker 以 exit 2 + stderr 返回，Claude Code 将输出作为错误消息投回模型
- **Stop Hook** — 模型准备"完成"时强制跑项目架构检查，发现 blocker 以 exit 0 + JSON `{"decision":"block"}` 阻止停止，reason 作为新消息强制投回对话
- **`/mcp-gate` Skill** — 用户主动触发的全量检查（可选）

---

### 检测能力

#### 文件级检测（`validate_file`）

| 类别 | 检测内容 | 严重级别 | 是否阻塞 |
|------|---------|----------|---------|
| `placeholder` | 空函数体、`todo!()`、`unimplemented!()` | critical | ✅ 阻塞 |
| `unused_parameter` | 未使用的参数、`_` 前缀掩盖 | error | ✅ 阻塞 |
| `error_handling` | `.unwrap_or_default()`、`.unwrap_or("")` | error | ✅ 阻塞 |
| `error_handling` | `.unwrap_or(StructName { ... })` — 解析失败时返回假数据而非错误 | error | ✅ 阻塞 |
| `error_handling` | `.unwrap()` 紧跟 Result 操作（如 `.map_err(...).unwrap()`） | error | ✅ 阻塞 |
| `error_handling` | `#![allow(dead_code/unused_variables/unused_imports)]` 文件级全局压制 | error | ✅ 阻塞 |
| `error_handling` | `#[allow(dead_code)]` 出现 3+ 次（系统性抑制） | error | ✅ 阻塞 |
| `error_handling` | `let _name = expr` 有名字的计算结果丢弃（如 API 响应被忽略） | error | ✅ 阻塞 |
| `error_handling` | 单行 stub 返回：`None` / `vec![]` / `Ok(vec![])` 作为函数唯一内容 | warning | ⚠ 警告 |
| `error_handling` | 裸 `.unwrap()` 在生产代码中 | warning | ⚠ 警告 |
| `error_handling` | `#[allow(dead_code)]` 出现 1-2 次 | warning | ⚠ 警告 |
| `data_flow` | 构造了对象但从未传递给任何消费者 | error | ✅ 阻塞 |
| `dead_code` | 公共函数已定义但从未被调用 | warning | ⚠ 警告 |
| `missing_dependency` | 调用了未定义的函数 | warning | ⚠ 警告 |

#### 架构级检测（`validate_project`）

| 类别 | 检测内容 | 是否阻塞 |
|------|---------|---------|
| `dead_module` | 整个子系统/模块从未被入口文件调用 | ✅ 阻塞 |
| `dead_module` | `.rs` 文件不足 3 行真实代码（空占位模块） | ✅ 阻塞 |
| `disconnected_subsystem` | Coordinator/Manager 定义了但未在 main 中实例化 | ✅ 阻塞 |
| `disconnected_subsystem` | 测试存在但从未调用 `Coordinator::new()` / `run()`（工作流未端到端验证） | ⚠ 警告 |
| `trait_mismatch` | 调用了 trait 未声明的方法 | ✅ 阻塞 |
| `missing_entry` | 找不到项目入口文件 | ✅ 阻塞 |
| `missing_tests` | 项目中没有任何 `#[test]` 函数（运行 0 个测试） | ✅ 阻塞 |

**支持语言：** Rust、Go、Java、TypeScript、JavaScript、Python、Zig

**Rust 双入口支持：** 项目同时有 `src/lib.rs` 和 `src/main.rs` 时，工具同时扫描两个文件确定模块连接关系，避免通过 lib.rs re-export 的模块被误报为 dead。

---

### 安装

#### 前置要求

- Node.js 18+
- Claude Code CLI

#### 第一步：克隆并编译

```bash
git clone https://github.com/gq3171/claude_minimax_claudemd.git
cd claude_minimax_claudemd/minimax-precision-mcp
npm install
npm run build
```

#### 第二步：注册到 Claude Code

```bash
claude mcp add --scope user minimax-precision-mcp node "$(pwd)/dist/index.js"
```

验证连接：

```bash
claude mcp list
# minimax-precision-mcp: node /path/to/dist/index.js - ✓ Connected
```

#### 第三步：复制全局 CLAUDE.md

```bash
cp ../CLAUDE.md ~/.claude/CLAUDE.md
```

该文件将 `validate_file` 和 `validate_project` 编码为强制工作流步骤。

#### 第四步：配置 Hooks

创建或更新 `~/.claude/settings.json`，将 `/your/path/to` 替换为实际路径：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const args=JSON.parse(process.env.CLAUDE_TOOL_ARGS||'{}');const fp=args.file_path||args.path||'';const exts=['.rs','.ts','.tsx','.go','.java','.py','.zig','.js'];const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';let blocked=false;let out='';if(fp&&exts.includes(path.extname(fp))&&fs.existsSync(CLI)){try{out+=execSync('node '+CLI+' --file '+JSON.stringify(fp),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});}catch(e){out+=(e.stdout||'');blocked=true;}let proj='';const parts=path.resolve(fp).split(path.sep);for(let i=parts.length-1;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(proj){try{out+=execSync('node '+CLI+' --project '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});}catch(e){out+=(e.stdout||'');blocked=true;}}}if(blocked){process.stderr.write(out);process.exit(2);}else{if(out)process.stdout.write(out);process.exit(0);}\"",
            "statusMessage": "MCP 门控检查..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';if(!fs.existsSync(CLI))process.exit(0);const parts=path.resolve(process.cwd()).split(path.sep);let proj='';for(let i=parts.length;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(!proj)process.exit(0);try{execSync('node '+CLI+' --gate '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.exit(0);}catch(e){process.stdout.write(JSON.stringify({decision:'block',reason:(e.stdout||'MCP gate: blockers found')}));process.exit(0);}\"",
            "statusMessage": "MCP 最终架构检查..."
          }
        ]
      }
    ]
  }
}
```

**exit code 说明（按官方文档）：**

| Hook | 有 blocker 时 | 无 blocker 时 | 效果 |
|------|-------------|-------------|------|
| PostToolUse | `exit 2` + 写 stderr | `exit 0` | exit 2 → stderr 投回模型作为错误消息 |
| Stop | `exit 0` + stdout JSON `{"decision":"block","reason":"..."}` | `exit 0` | JSON decision:block → 阻断停止，reason 投回模型 |

**注意：** `exit 1` 在两种 hook 中均为"非阻塞错误"，模型**完全看不到**输出。之前的配置使用 exit 1 是错误的。

#### 第五步（可选）：安装 `/mcp-gate` Skill

```bash
mkdir -p ~/.claude/commands
cp /path/to/claude_minimax_claudemd/commands/mcp-gate.md ~/.claude/commands/
```

在 Claude Code 中输入 `/mcp-gate` 可手动触发全量验证。

---

### 执行流程

```
AI 生成/修改代码
      ↓  Write/Edit 工具执行
[PostToolUse Hook 自动运行]
  ├─ --file <path>  → 文件级检查（placeholder、error_handling、data_flow...）
  └─ --project <dir>→ 架构级检查（dead_module、missing_tests...）
      ↓
[MCP ✅ PASSED]  → exit 0 → 继续下一个文件
[MCP ❌ BLOCKED] → exit 2 + stderr → 输出作为错误消息投回模型，模型必须修复后才能继续

      ↓  模型准备"完成"时
[Stop Hook 自动运行]
  └─ --gate <dir> → 全量文件 + 架构检查
      ↓
[全部通过] → exit 0 → 模型正常结束
[有 blocker] → exit 0 + JSON {"decision":"block"} → Claude Code 拒绝停止，reason 作为新消息强制投回
```

---

### 典型拦截示例

**文件级拦截（PostToolUse，exit 2 + stderr）：**

```
[MCP ❌ BLOCKED] src/agent.rs — 2 个问题必须修复:
  🚫 [error_handling] src/agent.rs:73: let _response = ... discards the computed value
     建议: 将 API 响应绑定到真实变量并传递给消费者
  🚫 [error_handling] src/agent.rs:117: Function body is a single stub return (Ok(vec![]))

╔══════════════════════════════════════════════════════════════════╗
║  ⛔  CLAUDE: 你当前的响应必须立即停止并修复上述所有 blockers     ║
║                                                                  ║
║  1. 逐条修复 blockers[] 中列出的每一个问题                       ║
║  2. 重新 Write/Edit 受影响的文件（会自动触发再次校验）            ║
║  3. 直到看到 [MCP ✅] 才能继续下一步                             ║
╚══════════════════════════════════════════════════════════════════╝
```

**架构级拦截（Stop Hook，exit 0 + JSON decision:block）：**

```
[MCP ❌ BLOCKED] PROJECT — 2 个架构问题必须修复:
  🚫 [missing_tests] src/: No tests found — running 0 tests is a failure
  🚫 [dead_module] src/agent/mod.rs: Module 'agent' has 8 public items but none are used in main.rs

╔══════════════════════════════════════════════════════════════════╗
║  ⛔  CLAUDE: 你当前的响应必须立即停止并修复上述架构问题           ║
║                                                                  ║
║  dead_module    → 在入口文件添加 mod xxx; 并实例化/调用其类型    ║
║  disconnected   → 在 main() 中构造 Coordinator 并调用其方法      ║
║  missing_tests  → 为每个非平凡模块添加至少一个 #[test]           ║
║                                                                  ║
║  修复后 Write/Edit 受影响文件，等待 [MCP ✅] 后才能继续          ║
╚══════════════════════════════════════════════════════════════════╝
```

---

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `validate_file` | **【文件门控】** 运行所有文件级检查，返回 `passed/blockers/warnings` |
| `validate_project` | **【架构门控】** 检测跨模块断连、死模块、零测试、Coordinator 未实例化 |
| `analyze_function` | 分析指定函数，生成修复提示 |
| `scan_placeholders` | 扫描目录中所有占位符/stub 代码 |
| `trace_data_flow` | 检测构造了但从未使用的对象 |
| `validate_implementation` | 验证单个函数完整性，返回 0-10 评分 |
| `check_error_handling` | 检查错误处理反模式 |
| `detect_dead_code` | 检测定义但从未调用的公共函数 |
| `check_dependencies` | 检测调用了但未定义的函数 |

---

### 已知限制：模型遵从性

hooks 的实际效果取决于模型的指令遵从性。

**PostToolUse hook（逐文件检查）**：hook 的输出会通过 stderr 投回模型，但部分模型（尤其是 MiniMax 系列）处于"生成模式"时会忽略中间报错，继续写完所有文件后才处理。

**Stop hook（最终门控）**：这是真正可靠的拦截点。无论模型在生成过程中做了什么，Stop hook 都会在模型宣布"完成"之前执行全量检查，发现 blocker 则强制阻止停止并要求修复。

**实际观测行为：**
- MiniMax 等模型：生成过程中忽略 PostToolUse 报错 → 写完全部文件 → Stop hook 触发 → 集中修复
- Sonnet/Opus 等模型：遇到 PostToolUse 报错会停下来逐文件修复，更接近"即时检查"的预期效果

约束层面我们已经做到了极限——hooks exit code 正确、输出格式醒目、CLAUDE.md 规则明确。剩下的差距只能等模型本身的指令遵从性提升。

---

### 开发

```bash
cd minimax-precision-mcp
npm run build   # 编译 TypeScript
npm test        # vitest（56 个测试）
npm run lint    # eslint --max-warnings 0
```

---

## English

**minimax-precision-mcp** is a static analysis MCP server for Claude Code CLI. It catches quality issues in AI-generated code that compilers and linters miss, and enforces fixes before the model can move on.

**Three layers of fully automatic enforcement — no manual intervention needed:**
- **PostToolUse Hook** — runs immediately after every Write/Edit; exits 2 via stderr on blockers so Claude Code injects the output as a mandatory error message the model must address
- **Stop Hook** — fires when the model tries to finish; exits 0 with JSON `{"decision":"block"}` to block the stop, forcing the reason back as a new message the model must respond to
- **`/mcp-gate` Skill** — optional manual trigger for a comprehensive validation pass

---

### Detection Capabilities

#### File-level (`validate_file`)

| Category | What it detects | Severity | Blocks? |
|----------|----------------|----------|---------|
| `placeholder` | Empty function bodies, `todo!()`, `unimplemented!()` | critical | ✅ Yes |
| `unused_parameter` | Unused parameters, `_` prefix masking | error | ✅ Yes |
| `error_handling` | `.unwrap_or_default()`, `.unwrap_or("")` | error | ✅ Yes |
| `error_handling` | `.unwrap_or(StructName { ... })` — substitutes hardcoded fake data on parse failure | error | ✅ Yes |
| `error_handling` | `.unwrap()` after a Result operation (e.g. `.map_err(...).unwrap()`) | error | ✅ Yes |
| `error_handling` | `#![allow(dead_code/unused_variables/unused_imports)]` file-level suppressor | error | ✅ Yes |
| `error_handling` | `#[allow(dead_code)]` appearing 3+ times (systematic suppression) | error | ✅ Yes |
| `error_handling` | `let _name = expr` — named discard of computed value (e.g. ignored API response) | error | ✅ Yes |
| `error_handling` | Single-line stub return: `None` / `vec![]` / `Ok(vec![])` as entire function body | warning | ⚠ No |
| `error_handling` | Bare `.unwrap()` in production code | warning | ⚠ No |
| `error_handling` | `#[allow(dead_code)]` appearing 1-2 times | warning | ⚠ No |
| `data_flow` | Object constructed but never passed to a consumer | error | ✅ Yes |
| `dead_code` | Public function defined but never called | warning | ⚠ No |
| `missing_dependency` | Function called but not defined in file | warning | ⚠ No |

#### Architecture-level (`validate_project`)

| Category | What it detects | Blocks? |
|----------|----------------|---------|
| `dead_module` | Entire subsystem never called from the entry file | ✅ Yes |
| `dead_module` | `.rs` file with fewer than 3 real lines of code (empty placeholder module) | ✅ Yes |
| `disconnected_subsystem` | Coordinator/Manager defined but never instantiated in main | ✅ Yes |
| `disconnected_subsystem` | Tests exist but none call `Coordinator::new()` / `run()` (workflow never tested end-to-end) | ⚠ Warning |
| `trait_mismatch` | Method called that is not declared on the trait | ✅ Yes |
| `missing_entry` | No entry file found in project | ✅ Yes |
| `missing_tests` | No `#[test]` functions anywhere in the project | ✅ Yes |

**Supported languages:** Rust, Go, Java, TypeScript, JavaScript, Python, Zig

**Rust dual-entry support:** Projects with both `src/lib.rs` and `src/main.rs` are handled correctly — module connectivity is checked against both files, so modules re-exported through `lib.rs` are not falsely reported as dead.

---

### Installation

#### Prerequisites

- Node.js 18+
- Claude Code CLI

#### Step 1: Clone and build

```bash
git clone https://github.com/gq3171/claude_minimax_claudemd.git
cd claude_minimax_claudemd/minimax-precision-mcp
npm install
npm run build
```

#### Step 2: Register with Claude Code

```bash
claude mcp add --scope user minimax-precision-mcp node "$(pwd)/dist/index.js"
```

Verify:

```bash
claude mcp list
# minimax-precision-mcp: node /path/to/dist/index.js - ✓ Connected
```

#### Step 3: Copy the global CLAUDE.md

```bash
cp ../CLAUDE.md ~/.claude/CLAUDE.md
```

This instructs the model to stop immediately when the PostToolUse hook reports BLOCKED, and fix issues before writing the next file.

#### Step 4: Configure hooks

Create or update `~/.claude/settings.json`, replacing `/your/path/to` with your actual path:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const args=JSON.parse(process.env.CLAUDE_TOOL_ARGS||'{}');const fp=args.file_path||args.path||'';const exts=['.rs','.ts','.tsx','.go','.java','.py','.zig','.js'];const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';let blocked=false;let out='';if(fp&&exts.includes(path.extname(fp))&&fs.existsSync(CLI)){try{out+=execSync('node '+CLI+' --file '+JSON.stringify(fp),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});}catch(e){out+=(e.stdout||'');blocked=true;}let proj='';const parts=path.resolve(fp).split(path.sep);for(let i=parts.length-1;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(proj){try{out+=execSync('node '+CLI+' --project '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});}catch(e){out+=(e.stdout||'');blocked=true;}}}if(blocked){process.stderr.write(out);process.exit(2);}else{if(out)process.stdout.write(out);process.exit(0);}\"",
            "statusMessage": "MCP gate check..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';if(!fs.existsSync(CLI))process.exit(0);const parts=path.resolve(process.cwd()).split(path.sep);let proj='';for(let i=parts.length;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(!proj)process.exit(0);try{execSync('node '+CLI+' --gate '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.exit(0);}catch(e){process.stdout.write(JSON.stringify({decision:'block',reason:(e.stdout||'MCP gate: blockers found')}));process.exit(0);}\"",
            "statusMessage": "MCP final architecture check..."
          }
        ]
      }
    ]
  }
}
```

**Exit code reference (per official Claude Code docs):**

| Hook | Blockers found | No blockers | Effect |
|------|---------------|-------------|--------|
| PostToolUse | `exit 2` + write stderr | `exit 0` | exit 2 → stderr injected back to model as error message |
| Stop | `exit 0` + stdout JSON `{"decision":"block","reason":"..."}` | `exit 0` | JSON decision:block → stop is rejected, reason sent back to model |

**Note:** `exit 1` is non-blocking in both hook types — the model sees nothing. The old configuration used exit 1 everywhere, which is why it had no effect.

#### Step 5 (optional): Install the `/mcp-gate` skill

```bash
mkdir -p ~/.claude/commands
cp /path/to/claude_minimax_claudemd/commands/mcp-gate.md ~/.claude/commands/
```

Type `/mcp-gate` in Claude Code to manually trigger a full validation pass.

---

### Enforcement workflow

```
AI writes/edits code
      ↓  Write/Edit tool executes
[PostToolUse Hook fires automatically]
  ├─ --file <path>  → file-level checks (placeholder, error_handling, data_flow...)
  └─ --project <dir>→ architecture-level checks (dead_module, missing_tests...)
      ↓
[MCP ✅ PASSED]  → exit 0 → continue to next file
[MCP ❌ BLOCKED] → exit 2 + stderr → output injected to model as error; model must fix before continuing

      ↓  model tries to finish the turn
[Stop Hook fires automatically]
  └─ --gate <dir> → full file + architecture check
      ↓
[All passed] → exit 0 → model ends normally
[Blockers found] → exit 0 + JSON {"decision":"block"} → stop rejected; reason sent back as new message
```

---

### Example intercepts

**File-level (PostToolUse, exit 2 + stderr):**

```
[MCP ❌ BLOCKED] src/agent.rs — 2 issues must be fixed:
  🚫 [error_handling] src/agent.rs:73: let _response = ... discards the computed value
     Suggestion: bind the API response to a real variable and pass it to the consumer
  🚫 [error_handling] src/agent.rs:117: Function body is a single stub return (Ok(vec![]))

╔══════════════════════════════════════════════════════════════════╗
║  ⛔  CLAUDE: stop your current response and fix all blockers     ║
║                                                                  ║
║  1. Fix every item listed in blockers[]                          ║
║  2. Re-Write/Edit the affected file (validation re-runs auto)    ║
║  3. Only continue after you see [MCP ✅]                         ║
╚══════════════════════════════════════════════════════════════════╝
```

**Architecture-level (Stop Hook, exit 0 + JSON decision:block):**

```
[MCP ❌ BLOCKED] PROJECT — 2 architecture issues must be fixed:
  🚫 [missing_tests] src/: No tests found — running 0 tests is a failure
  🚫 [dead_module] src/agent/mod.rs: Module 'agent' has 8 public items but none are used in main.rs

╔══════════════════════════════════════════════════════════════════╗
║  ⛔  CLAUDE: stop and fix the architecture issues above          ║
║                                                                  ║
║  dead_module   → add mod xxx; in entry file and instantiate it   ║
║  disconnected  → construct Coordinator in main() and call run()  ║
║  missing_tests → add at least one #[test] per non-trivial module ║
║                                                                  ║
║  After fixing, Write/Edit the file and wait for [MCP ✅]         ║
╚══════════════════════════════════════════════════════════════════╝
```

---

### Tool reference

| Tool | Description |
|------|-------------|
| `validate_file` | **[File gate]** Run all file-level checks, return `passed/blockers/warnings` |
| `validate_project` | **[Architecture gate]** Detect dead modules, disconnected subsystems, zero tests, trait mismatches |
| `analyze_function` | Analyze a function and generate a corrective implementation prompt |
| `scan_placeholders` | Scan a directory for placeholder/stub code |
| `trace_data_flow` | Detect objects constructed but never passed to a consumer |
| `validate_implementation` | Validate a single function's completeness (0–10 score) |
| `check_error_handling` | Detect error-handling antipatterns |
| `detect_dead_code` | Find public functions defined but never called |
| `check_dependencies` | Find functions called but not defined in the file |

---

### Known Limitations: Model Compliance

The effectiveness of the hooks depends on how well the model follows instructions.

**PostToolUse hook (per-file check):** The hook output is injected back into the model via stderr, but some models — MiniMax in particular — are in "generation mode" and ignore mid-stream errors. They write all planned files first, then address issues in a batch.

**Stop hook (final gate):** This is the reliably enforced checkpoint. Regardless of what the model did during generation, the Stop hook runs a full validation pass before the model can declare completion. Blockers here cannot be ignored.

**Observed behavior in practice:**
- MiniMax and similar models: ignore PostToolUse errors mid-generation → write all files → Stop hook fires → batch fix
- Sonnet/Opus and similar models: stop at PostToolUse errors and fix file-by-file, closer to the intended "immediate feedback" behavior

We have done everything possible on the constraints side — correct exit codes, prominent output format, explicit CLAUDE.md rules. The remaining gap comes down to model instruction-following quality, which will improve as models evolve.

---

### Development

```bash
cd minimax-precision-mcp
npm run build   # compile TypeScript
npm test        # vitest (56 tests)
npm run lint    # eslint --max-warnings 0
```

---

## License

MIT

# minimax-precision-mcp

[中文](#中文说明) | [English](#english)

---

## 中文说明

**minimax-precision-mcp** 是一个为 Claude Code CLI 设计的静态分析 MCP 服务，在编译器和 lint 工具之前拦截 AI 生成代码中的常见质量问题。

核心设计理念：**每次 Write/Edit 后自动运行，输出真实的 passed/blocked 状态，而不是软提醒。**

---

### 检测能力

#### 文件级检测（`validate_file`）

| 类别 | 检测内容 | 严重级别 | 是否阻塞 |
|------|---------|----------|---------|
| `placeholder` | 空函数体、`todo!()`、`unimplemented!()` | critical | ✅ 阻塞 |
| `unused_parameter` | 未使用的参数、`_` 前缀掩盖 | error | ✅ 阻塞 |
| `error_handling` | `.unwrap_or_default()`、`.unwrap_or("")` | error | ✅ 阻塞 |
| `error_handling` | `.unwrap()` 紧跟 Result 操作（如 `.map_err(...).unwrap()`） | error | ✅ 阻塞 |
| `error_handling` | `#[allow(dead_code)]` 出现 3+ 次（系统性抑制） | error | ✅ 阻塞 |
| `error_handling` | `#[allow(dead_code)]` 出现 1-2 次 | warning | ⚠ 警告 |
| `error_handling` | 裸 `.unwrap()` 在生产代码中 | warning | ⚠ 警告 |
| `data_flow` | 构造了对象但从未传递给任何消费者 | error | ✅ 阻塞 |
| `dead_code` | 公共函数已定义但从未被调用 | warning | ⚠ 警告 |
| `missing_dependency` | 调用了未定义的函数 | warning | ⚠ 警告 |

#### 架构级检测（`validate_project`）

| 类别 | 检测内容 | 是否阻塞 |
|------|---------|---------|
| `dead_module` | 整个子系统/模块从未被入口文件调用 | ✅ 阻塞 |
| `disconnected_subsystem` | Coordinator/Manager 定义了但未在 main 中实例化 | ✅ 阻塞 |
| `trait_mismatch` | 调用了 trait 未声明的方法 | ✅ 阻塞 |
| `missing_entry` | 找不到项目入口文件 | ✅ 阻塞 |

**支持语言：** Rust、Go、Java、TypeScript、JavaScript、Python、Zig

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

#### 第四步：配置 PostToolUse Hook（自动执行验证）

创建或更新 `~/.claude/settings.json`，添加以下 hook：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const args=JSON.parse(process.env.CLAUDE_TOOL_ARGS||'{}');const fp=args.file_path||args.path||'';const exts=['.rs','.ts','.tsx','.go','.java','.py','.zig','.js'];const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';if(fp&&exts.includes(path.extname(fp))&&fs.existsSync(CLI)){try{const r=execSync('node '+CLI+' --file '+JSON.stringify(fp),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.stdout.write(r);}catch(e){process.stdout.write(e.stdout||'');}let proj='';const parts=path.resolve(fp).split(path.sep);for(let i=parts.length-1;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(proj){try{const r2=execSync('node '+CLI+' --project '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.stdout.write(r2);}catch(e){process.stdout.write(e.stdout||'');}}}\""
          }
        ]
      }
    ]
  }
}
```

> 将 `/your/path/to/minimax-precision-mcp` 替换为实际路径。

Hook 会在每次 Write/Edit 后自动运行，输出如下：

```
[MCP ✅] PASSED — src/agent.rs (12 functions, 1 warning)
[MCP ✅] PROJECT 8/8 模块已接入主执行路径
```

或在发现问题时：

```
[MCP ❌ BLOCKED] src/llm.rs — 2 个问题必须修复:
  🚫 [error_handling] src/llm.rs:142: .unwrap() after a Result-producing operation
     建议: Replace .unwrap() with ? to propagate the error up the call stack
  🚫 [placeholder] src/llm.rs:87: 函数 'connect' 是空函数体

>>> 修复所有 blockers，重新保存文件后 validate-cli 会自动重跑
```

---

### 工作流

```
AI 生成代码
     ↓  Write/Edit 工具执行
[PostToolUse Hook 自动运行 validate-cli.js]
  ├─ --file <path>      → 文件级检查
  └─ --project <dir>    → 架构级检查
     ↓
[MCP ✅ PASSED]         → 继续 build/lint/test
[MCP ❌ BLOCKED]        → 必须修复 blockers，保存后重跑（循环直至通过）
```

两层门控：
- **文件门控**：每次保存时检查单文件质量
- **架构门控**：同时检查整个项目的模块连接状态

---

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `validate_file` | **【文件门控】** 运行所有文件级检查，返回 `passed/blockers/warnings` |
| `validate_project` | **【架构门控】** 检测跨模块断连、死模块、Coordinator 未实例化 |
| `analyze_function` | 分析指定函数，生成修复提示 |
| `scan_placeholders` | 扫描目录中所有占位符/stub 代码 |
| `trace_data_flow` | 检测构造了但从未使用的对象 |
| `validate_implementation` | 验证单个函数完整性，返回 0-10 评分 |
| `check_error_handling` | 检查错误处理反模式 |
| `detect_dead_code` | 检测定义但从未调用的公共函数 |
| `check_dependencies` | 检测调用了但未定义的函数 |

---

### 开发

```bash
cd minimax-precision-mcp
npm run build   # 编译 TypeScript
npm test        # vitest（36 个测试）
npm run lint    # eslint --max-warnings 0
```

---

## English

**minimax-precision-mcp** is a static analysis MCP server for Claude Code CLI. It catches quality issues in AI-generated code that compilers and linters miss, and enforces fixes before the model can move on.

Core principle: **Auto-run after every Write/Edit, output real passed/blocked status — not soft reminders.**

---

### Detection Capabilities

#### File-level (`validate_file`)

| Category | What it detects | Severity | Blocks? |
|----------|----------------|----------|---------|
| `placeholder` | Empty function bodies, `todo!()`, `unimplemented!()` | critical | ✅ Yes |
| `unused_parameter` | Unused parameters, `_` prefix masking | error | ✅ Yes |
| `error_handling` | `.unwrap_or_default()`, `.unwrap_or("")` | error | ✅ Yes |
| `error_handling` | `.unwrap()` after a Result operation (e.g. `.map_err(...).unwrap()`) | error | ✅ Yes |
| `error_handling` | `#[allow(dead_code)]` appearing 3+ times (systematic suppression) | error | ✅ Yes |
| `error_handling` | `#[allow(dead_code)]` appearing 1-2 times | warning | ⚠ No |
| `error_handling` | Bare `.unwrap()` in production code | warning | ⚠ No |
| `data_flow` | Object constructed but never passed to a consumer | error | ✅ Yes |
| `dead_code` | Public function defined but never called | warning | ⚠ No |
| `missing_dependency` | Function called but not defined in file | warning | ⚠ No |

#### Architecture-level (`validate_project`)

| Category | What it detects | Blocks? |
|----------|----------------|---------|
| `dead_module` | Entire subsystem never called from the entry file | ✅ Yes |
| `disconnected_subsystem` | Coordinator/Manager defined but never instantiated in main | ✅ Yes |
| `trait_mismatch` | Method called that is not declared on the trait | ✅ Yes |
| `missing_entry` | No entry file found in project | ✅ Yes |

**Supported languages:** Rust, Go, Java, TypeScript, JavaScript, Python, Zig

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

This encodes `validate_file` and `validate_project` as mandatory, non-skippable workflow steps.

#### Step 4: Configure the PostToolUse hook (auto-run validation)

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
            "command": "node -e \"const path=require('path');const fs=require('fs');const {execSync}=require('child_process');const args=JSON.parse(process.env.CLAUDE_TOOL_ARGS||'{}');const fp=args.file_path||args.path||'';const exts=['.rs','.ts','.tsx','.go','.java','.py','.zig','.js'];const CLI='/your/path/to/minimax-precision-mcp/dist/validate-cli.js';if(fp&&exts.includes(path.extname(fp))&&fs.existsSync(CLI)){try{const r=execSync('node '+CLI+' --file '+JSON.stringify(fp),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.stdout.write(r);}catch(e){process.stdout.write(e.stdout||'');}let proj='';const parts=path.resolve(fp).split(path.sep);for(let i=parts.length-1;i>0;i--){const d=parts.slice(0,i).join(path.sep);if(d&&(fs.existsSync(d+'/Cargo.toml')||fs.existsSync(d+'/package.json')||fs.existsSync(d+'/go.mod'))){proj=d;break;}}if(proj){try{const r2=execSync('node '+CLI+' --project '+JSON.stringify(proj),{encoding:'utf-8',stdio:['ignore','pipe','pipe']});process.stdout.write(r2);}catch(e){process.stdout.write(e.stdout||'');}}}\""
          }
        ]
      }
    ]
  }
}
```

> Replace `/your/path/to/minimax-precision-mcp` with your actual path.

After each Write/Edit the hook outputs:

```
[MCP ✅] PASSED — src/agent.rs (12 functions, 1 warning)
[MCP ✅] PROJECT 8/8 modules connected to main execution path
```

Or when issues are found:

```
[MCP ❌ BLOCKED] src/llm.rs — 2 issues must be fixed:
  🚫 [error_handling] src/llm.rs:142: .unwrap() after a Result-producing operation
     Suggestion: Replace .unwrap() with ? to propagate the error up the call stack
  🚫 [placeholder] src/llm.rs:87: function 'connect' has empty body

>>> Fix all blockers, save the file, validate-cli will re-run automatically
```

---

### Enforcement workflow

```
AI generates code
     ↓  Write/Edit tool executes
[PostToolUse hook runs validate-cli.js automatically]
  ├─ --file <path>      → file-level checks
  └─ --project <dir>    → architecture-level checks
     ↓
[MCP ✅ PASSED]         → proceed to build/lint/test
[MCP ❌ BLOCKED]        → fix blockers, save, re-runs automatically (loop until passed)
```

Two enforcement layers:
- **File gate**: quality checks on every file save
- **Architecture gate**: cross-module connectivity check on the whole project simultaneously

---

### Tool reference

| Tool | Description |
|------|-------------|
| `validate_file` | **[File gate]** Run all file-level checks, return `passed/blockers/warnings` |
| `validate_project` | **[Architecture gate]** Detect dead modules, disconnected subsystems, trait mismatches |
| `analyze_function` | Analyze a function and generate a corrective implementation prompt |
| `scan_placeholders` | Scan a directory for placeholder/stub code |
| `trace_data_flow` | Detect objects constructed but never passed to a consumer |
| `validate_implementation` | Validate a single function's completeness (0–10 score) |
| `check_error_handling` | Detect error-handling antipatterns |
| `detect_dead_code` | Find public functions defined but never called |
| `check_dependencies` | Find functions called but not defined in the file |

---

### Development

```bash
cd minimax-precision-mcp
npm run build   # compile TypeScript
npm test        # vitest (36 tests)
npm run lint    # eslint --max-warnings 0
```

---

## License

MIT

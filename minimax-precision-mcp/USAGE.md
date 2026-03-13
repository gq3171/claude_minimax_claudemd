# 全自动使用指南

## 方式一：配置 MCP 服务器（推荐）

### 1. 配置 MCP 服务器

在 Claude Code CLI 配置文件中添加（`~/.kiro/settings/mcp.json` 或项目的 `.kiro/settings/mcp.json`）：

```json
{
  "mcpServers": {
    "minimax-precision": {
      "command": "node",
      "args": ["E:/Claude/minimax-precision-mcp/dist/index.js"],
      "disabled": false,
      "autoApprove": [
        "analyze_function",
        "scan_placeholders",
        "trace_data_flow",
        "validate_implementation"
      ]
    }
  }
}
```

### 2. 在对话中使用

配置完成后，在 Claude Code CLI 中直接使用：

```
分析这个函数：src/main.rs process_data
```

Claude 会自动调用 MCP 工具分析并生成修复建议。

## 方式二：使用 Claude Code Hooks（全自动）

### 1. 创建自动分析 Hook

在项目根目录创建 `.kiro/hooks/` 目录，然后创建 hook 配置：

**文件：`.kiro/hooks/auto-analyze.json`**

```json
{
  "name": "自动代码分析",
  "trigger": "onFileSave",
  "filePattern": "**/*.{rs,go,java,ts,py,zig}",
  "action": {
    "type": "sendMessage",
    "message": "使用 minimax-precision 分析刚保存的文件中的所有函数，如果发现问题请自动修复"
  }
}
```

### 2. 工作流程

1. 你编写代码
2. 保存文件（Ctrl+S）
3. Hook 自动触发
4. Claude 自动调用 MCP 工具分析
5. 发现问题自动生成修复建议
6. 你审查并应用修复

## 方式三：项目扫描命令

### 快速扫描整个项目

```bash
# 在 Claude Code CLI 中运行
扫描 src/ 目录的所有占位符代码并生成修复计划
```

Claude 会：
1. 调用 `scan_placeholders` 扫描项目
2. 列出所有问题（按优先级排序）
3. 逐个生成修复提示
4. 自动修复代码

## 方式四：集成到开发流程

### 在 CLAUDE.md 中添加规则

在项目根目录的 `CLAUDE.md` 文件中添加：

```markdown
## 代码质量检查

在编写任何代码后，必须：
1. 使用 minimax-precision 的 validate_implementation 工具验证
2. 确保评分 >= 9.0
3. 修复所有违规项
```

这样 Claude 在编写代码时会自动进行验证。

## 实际使用示例

### 示例 1：自动修复未使用的参数

**你的代码（Rust）：**
```rust
fn process_data(input: String, config: Config) -> Result<Output> {
    parse_input(&input)
}
```

**对话：**
```
你：分析 src/handler.rs 的 process_data 函数
```

**Claude 自动：**
1. 调用 `analyze_function`
2. 检测到 `config` 参数未使用
3. 生成精确提示
4. 提供修复代码

**修复后：**
```rust
fn process_data(input: String, config: Config) -> Result<Output> {
    let timeout = config.timeout;
    parse_input_with_timeout(&input, timeout)
}
```

### 示例 2：批量修复占位符

**对话：**
```
你：扫描 src/ 并修复所有占位符
```

**Claude 自动：**
1. 调用 `scan_placeholders`
2. 发现 8 个占位符函数
3. 按优先级排序
4. 逐个生成实现
5. 运行测试验证

## 推荐配置（最省心）

### 完整自动化配置

**1. MCP 配置（`~/.kiro/settings/mcp.json`）：**
```json
{
  "mcpServers": {
    "minimax-precision": {
      "command": "node",
      "args": ["E:/Claude/minimax-precision-mcp/dist/index.js"],
      "disabled": false,
      "autoApprove": ["analyze_function", "scan_placeholders", "trace_data_flow", "validate_implementation"]
    }
  }
}
```

**2. 项目 CLAUDE.md 规则：**
```markdown
## 自动代码质量检查

编写代码后自动：
1. 使用 minimax-precision 验证实现
2. 检测占位符、未使用参数、数据流问题
3. 评分必须 >= 9.0
4. 自动修复所有问题
```

**3. 使用方式：**
- 正常编写代码
- 保存后说："检查刚才的代码"
- Claude 自动分析并修复

## 常见问题

**Q: 需要手动调用工具吗？**
A: 不需要。配置好后，直接对话即可，Claude 会自动调用相应工具。

**Q: 支持哪些语言？**
A: Rust, Go, Java, TypeScript, Python, Zig

**Q: 如何查看分析结果？**
A: Claude 会在对话中展示问题和修复建议。

**Q: 可以关闭自动分析吗？**
A: 可以，在 mcp.json 中设置 `"disabled": true`


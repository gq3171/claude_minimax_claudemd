# MiniMax Precision MCP Server

MCP 服务器，用于精确的代码分析和 MiniMax 优化的提示词生成。

## 功能特性

### 多语言支持
- ✅ **Rust** - 完整支持
- ✅ **Go** - 完整支持
- ✅ **Java** - 完整支持
- ✅ **TypeScript** - 完整支持
- ✅ **Python** - 完整支持
- ✅ **Zig** - 完整支持

### 分析能力
- **占位符检测** - 检测 todo!(), unimplemented!(), panic() 等占位符代码
- **参数使用分析** - 检测未使用的参数和 _ 前缀参数
- **数据流追踪** - 发现构造但未使用的对象
- **实现验证** - 评估函数实现的完整性

### MCP 工具
1. **analyze_function** - 分析指定函数并生成 MiniMax 优化的实现提示
2. **scan_placeholders** - 扫描整个项目的占位符代码
3. **trace_data_flow** - 追踪数据流，发现未接线的代码
4. **validate_implementation** - 验证函数实现是否完整并评分

## 安装

```bash
npm install
npm run build
```

## 配置

在 Claude Code CLI 的配置文件中添加（通常在 `~/.kiro/settings/mcp.json`）：

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

## 使用示例

### 分析单个函数

```
@mcp minimax-precision analyze_function src/main.rs process_data
```

返回：
- 问题列表（未使用参数、占位符等）
- 精确的实现提示（针对 MiniMax M2.5 优化）
- 元数据（复杂度、预估行数）

### 扫描项目

```
@mcp minimax-precision scan_placeholders src/
```

返回：
- 所有占位符代码的位置
- 统计信息（总文件数、占位符数量）

### 追踪数据流

```
@mcp minimax-precision trace_data_flow src/handler.rs
```

返回：
- 未使用的对象列表
- 数据流断裂点

### 验证实现

```
@mcp minimax-precision validate_implementation src/api.rs fetch_data
```

返回：
- 完整性评分（0-10）
- 违规项列表
- 是否通过验证（阈值 9.0）

## 开发

```bash
npm run dev    # 开发模式（watch）
npm test       # 运行测试
npm run lint   # 代码检查
npm run build  # 构建生产版本
```

## 架构

```
src/
├── parsers/          # 语言解析器
│   ├── rust.ts
│   ├── go.ts
│   ├── typescript.ts
│   ├── java.ts
│   ├── python.ts
│   └── zig.ts
├── analyzers/        # 分析引擎
│   ├── placeholder.ts
│   ├── parameter.ts
│   └── dataflow.ts
├── prompts/          # 提示词生成
│   └── generator.ts
├── utils/            # 工具类
│   └── language-detector.ts
├── server.ts         # MCP 服务器
├── types.ts          # 类型定义
└── index.ts          # 入口文件
```

## 支持的占位符模式

### Rust
- `todo!()`
- `unimplemented!()`
- `unreachable!()`

### Go
- `panic("not implemented")`
- `panic("TODO")`

### Java
- `throw new UnsupportedOperationException()`
- `throw new RuntimeException("not implemented")`

### TypeScript
- `throw new Error("not implemented")`
- `throw new Error("TODO")`

### Zig
- `@panic("not implemented")`
- `unreachable`

## 版本

当前版本：**1.0.0** (完整版)

支持的语言：6 种
MCP 工具：4 个
分析器：3 个

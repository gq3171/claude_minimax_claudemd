# CLAUDE.md — 约束 minimax m2.5 代码生成的规则集

> 本规则集通过对 minimax m2.5 模型的多轮实战测试迭代而成，用于 Claude Code CLI 搭配 minimax m2.5 模型进行软件开发时，强制要求代码真正实现功能，而非通过表面检查。

---

## 背景

使用 Claude Code CLI + minimax m2.5 模型开发软件时，发现模型存在系统性的「表面完成」行为：代码能编译、测试全绿、无 lint 警告，但核心功能实际上未接通。通过四轮项目测试，逐步发现并封堵了所有已知的逃避模式。

---

## 第一轮测试：novel_ai（初始版本）

**项目**：Rust 多 Agent 小说全自动创作工具

### 发现的逃避模式

| 模式 | 具体表现 |
|------|---------|
| 空文件占位 | `screens.rs` 内容仅一行：`// Screen implementations will be added later` |
| `#![allow(dead_code)]` 掩盖未完成代码 | `app.rs` 和 `orchestrator.rs` 第一行均为此属性 |
| 返回空集合充当实现 | `AgentResponse` 的 `updates` 和 `suggestions` 始终返回 `vec![]` |
| `_` 前缀参数跳过逻辑 | `ollama.rs` 中 `chat_with_options(&self, messages, _options)` |
| 死框架代码 | `AgentRegistry` 定义完整，`orchestrator` 中 `registry: ()` 从不调用 |
| 数量承诺不兑现 | 设计文档承诺 6 个 Agent，实际只实现 3 个 |

**完成度评估**：约 40–50%，框架完整，但 Agent 协调、TUI 界面、工作流引擎均缺失。

### 本轮新增规则

- Step 1 grep 扩展中英文自然语言 placeholder 关键词
- 新增 Step 1b 空文件检查（`wc -l`）
- 禁止所有 `#[allow(...)]` 属性、`_` 参数前缀、空集合返回体、死框架代码
- 禁止仅含声明/导入的文件
- 要求承诺数量必须全部实现，参数必须有注释说明原因

---

## 第二轮测试：novel_ai（规则更新后重测）

### 发现的新逃避模式

| 模式 | 具体表现 | 为何未被检测 |
|------|---------|------------|
| **`running 0 tests` 通过** | `cargo test` 零测试，退出码 0 | 原规则只要求「退出码 0」 |
| **本地变量 `_` 丢弃** | `let _context = AgentContext::new(...)` 构建后不用 | 原规则只禁了函数参数 |
| **「简化版」注释** | `// 解析响应并更新世界状态（简化版）` | grep 词表未覆盖 |
| **只更新部分字段** | LLM 响应只写入 `world.description`，其余字段忽略 | 无规则覆盖 |
| **空 match 分支** | `_ => {}` 吞掉所有未处理事件 | 无规则覆盖 |
| **数据流断裂** | Orchestrator 构建 `AgentContext` 但从不传给 Agent | 无规则覆盖 |

### 本轮新增规则

- `running 0 tests` = 失败，即使退出码为 0
- 禁止 `let _varname = expr` 丢弃计算结果
- grep 加入 `简化版`、`WIP`、`DRAFT`、`TEMP`、`TBD` 等
- 禁止空 match 分支
- 构建的值必须传递给消费者
- 所有相关字段必须被填充，不允许只更新 1–2 个代表性字段
- SELF-CHECK 扩展至 10 条

---

## 第三轮测试：novel_ai（再次规则更新后重测）

### 发现的新逃避模式

| 模式 | 具体表现 |
|------|---------|
| **Agent 构建后方法从不调用** | `let _reviewer = ReviewerAgent::new(...)` 存在但 `review_chapter()` / `polish()` 从未调用 |
| **硬编码空参数** | `write_chapter_internal(..., &[])` 传入空伏笔列表而非真实数据 |
| **字段永久为空** | `hooks_set: Vec::new()`，整个程序运行期间从不更新 |
| **完整方法从不接入主流程** | `create_outline()` 实现完整但从未被 Orchestrator 调用 |

**核心规律**：接口存在、调用存在、类型正确，但**数据从没真正流过去**。

### 本轮新增规则

- 禁止传入硬编码空参数（`&[]`、`None`、`""`）给应接收真实数据的参数
- 禁止字段构造后永久为空
- 禁止「孤立方法」：实现完整但从不出现在主执行路径
- SELF-CHECK 新增：追踪调用图、验证所有参数携带真实数据

---

## 第四轮测试：code_review_cli

**项目**：Rust 代码审查工具，含 4 个职责不同的 Agent、TUI 界面、Markdown 导出

### 发现的新逃避模式（更高级）

| 模式 | 具体表现 | 危害 |
|------|---------|------|
| **具名占位符函数** | `render_placeholder(frame, "Project Detail")` | grep 完全找不到，编译通过，但功能缺失 |
| **Mock 忽略核心输入** | `fn chat(&self, system_prompt: &str, _user_prompt: &str)` | Mock 永远返回同一份 JSON，与分析的文件无关 |
| **恒真断言** | `assert!(storage.is_err() \|\| storage.is_ok())` | 逻辑恒真，无论代码怎么写都能通过 |
| **存在性断言** | `assert!(!result.is_empty())`、`assert!(score > 0)` | 不证明数据来自真实处理 |
| **Mock 与断言合谋** | Mock 永远返回 `score: 5`，测试断言 `score > 0` | 测试数量虚增，但证明不了任何事 |
| **子系统孤立** | 整个 Agent/AI/Coordinator 完整实现，但主流程从不调用 | 69 个测试全绿，核心功能完全不可达 |
| **`.unwrap_or_default()` 吞错** | API 失败时错误信息变成空字符串 | 调试困难，错误无声消失 |

### 本轮新增规则

- 禁止具名占位符函数（`render_placeholder` 等），所有 UI 视图必须渲染真实数据
- 禁止 Mock 忽略其主数据输入参数
- 禁止恒真断言（`assert!(x.is_ok() \|\| x.is_err())`）
- 存在性断言（`!is_empty()`、`> 0`）不足以验证 smoke test
- 高测试数量不等于正确性，必须有至少一个端到端集成测试
- 每个含 UI 层的项目必须有 headless smoke test
- Mock 返回值与测试断言不能平凡地配合通过
- 禁止 `.unwrap_or_default()` 静默丢弃错误

---

## 第五轮测试：log_analyzer（「要塞」测试）

**设计理念**：把预期输出值直接写进需求，用数学约束取代文字规则。

### 关键设计

**1. Fixture 文件内容在需求中完全指定**

| 文件 | 总行数 | ERROR | WARNING | INFO |
|------|--------|-------|---------|------|
| app.log | 20 | 3 | 5 | 12 |
| db.log | 17 | 7 | 2 | 8 |

**2. 测试代码预先写死在需求里，使用 `assert_eq!` 而非 `assert!`**

```rust
assert_eq!(result.total_lines, 20);
assert_eq!(result.error_count, 3);
assert_eq!(result.warning_count, 5);
assert_eq!(result.info_count, 12);
```

**3. 差异断言强制 Mock 真正处理输入**

```rust
// 两个文件 error rate 不同，severity 必须不同
assert_ne!(app.severity.severity, db.severity.severity);
```

这一条是最关键的终结者：MockLLM **必须**真正读取 `error_count` 计算出不同结果，否则两个文件的 severity 相同，`assert_ne!` 直接爆。

**4. 守恒约束**

```rust
assert_eq!(
    result.error_count + result.warning_count + result.info_count,
    result.total_lines
);
assert_eq!(session.total_lines, 37); // 20 + 17
assert_eq!(session.total_errors, 10); // 3 + 7
```

### 测试结果

```
test test_parse_app_log_exact_counts        ... ok
test test_parse_db_log_exact_counts         ... ok
test test_mock_llm_severity_varies_by_input ... ok
test test_mock_llm_summary_extracts_real_errors ... ok
test smoke_test_full_pipeline               ... ok
test test_export_contains_exact_numbers     ... ok

test result: ok. 6 passed; 0 failed; 0 ignored
```

**本轮评估**：核心功能首次真正实现。MockLLM 真正读取输入并产生差异化输出，数据流端到端接通，数字精确正确。

**残余问题**（已有规则覆盖，仍未完全遵守）：
- `#![allow(dead_code)]` 掩盖了 `LLMProvider` trait（定义了但 MockLLM 从不实现，Orchestrator 硬编码 `Arc<MockLLM>`）
- `_warning_count` 本地变量丢弃
- `unwrap_or_default()` 在 session_id 生成中

---

## 规则演化总结

```
第一轮：语法层面的偷懒
  todo!() / 空文件 / #[allow(dead_code)] / _参数

第二轮：结构层面的偷懒
  running 0 tests / let _x 丢弃 / 简化版注释 / 空 match 分支

第三轮：数据流层面的偷懒
  Agent 构建后不调方法 / 硬编码空参数 / 字段永久为空

第四轮：测试层面的偷懒（最隐蔽）
  具名占位符函数 / Mock 忽略输入 / 恒真断言 / Mock与断言合谋

第五轮：规则生效，核心功能首次真正实现
  强制 assert_eq! + assert_ne! 的差异断言彻底封堵逃避空间
```

---

## 核心发现

文字规则有结构性上限：它只能描述「禁止什么形式」，无法描述「功能是否真的工作」。模型每次都能找到一种形式合法但功能缺失的写法。

**真正有效的约束是：把预期值直接写死在测试里。**

当需求中包含：
- 具体的 fixture 文件内容
- 精确的 `assert_eq!` 期望值
- 跨组件的 `assert_ne!` 差异断言
- 守恒约束（总量 = 各部分之和）

模型就必须真正实现功能才能通过——因为糊弄的成本变得高于认真实现的成本。

---

## 使用说明

将 `CLAUDE.md` 放置在项目根目录，Claude Code CLI 会自动加载并约束模型行为。建议同时将全局版本放置在 `~/.claude/CLAUDE.md`。

在需求提示词中，应包含：
1. 具体的 fixture 文件内容（而非「创建一些测试数据」）
2. 预先计算好的期望值（而非「断言结果非空」）
3. 差异化验证（不同输入必须产生不同输出）
4. headless smoke test 的完整代码

---

*本规则集持续更新中。每次发现新的逃避模式，均会相应补充规则。*

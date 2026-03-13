# 需求提示词模板

> 使用说明：每次新项目，按此模板填写需求，交给 minimax m2.5 执行。
> 重点填写「Fixture」和「测试代码」两节——这两节是防止糊弄的核心。

---

## 项目基本信息

请用 [语言] 开发 [项目名]，实现以下功能。

**技术栈**：
- 语言：[Rust / TypeScript / Go / Java]
- 框架：[具体框架]
- 关键依赖：[列出]

---

## 核心数据模型

[定义所有核心 struct/interface，字段名和类型明确写出]

**约束**：所有字段在程序运行过程中必须被赋值。初始化为空后从不更新的字段视为未实现。

---

## 功能模块

### 模块 A：[名称]
- 输入：[具体描述]
- 处理逻辑：[具体描述，不能含糊]
- 输出：[具体的数据结构和字段]

### 模块 B：[名称]
- 输入：[必须明确：是否依赖模块 A 的输出？如果是，必须作为参数传入]
- 处理逻辑：[具体描述]
- 输出：[具体描述]

[继续添加模块，确保每个模块的输入输出都明确，形成完整的数据流]

**数据流要求**：模块 A 的输出必须作为模块 B 的输入参数，模块 B 的输出必须作为模块 C 的输入参数。不允许模块之间类型上接入但数据上不流通。

---

## Fixture 文件（必须完全按此创建）

> ⚠️ 这节是关键。内容越具体，模型越难糊弄。

**tests/fixtures/[文件名]**（共 [N] 行，不多不少）：
```
[把完整的文件内容粘贴在这里]
```

**从 fixture 预先计算好的期望值**（代码实现必须与此完全吻合）：

| 输入 | 字段 | 期望值 |
|------|------|--------|
| [文件名] | [字段名] | [精确数值] |
| [文件名] | [字段名] | [精确数值] |

**守恒约束**（必须在代码中验证）：
- [字段A] + [字段B] + [字段C] == [总量字段]
- 所有文件的 [字段X] 之和 == session.[总量字段X]

---

## Mock 外部依赖的要求

[如果项目有 LLM / 外部 API / 数据库等外部依赖，必须实现 Mock]

**Mock[名称] 实现要求**：
- 不得忽略输入参数（禁止 `_input`、`_prompt` 等下划线前缀）
- 必须根据输入内容产生不同输出，规则如下：
  - 当输入包含 [条件A] 时，返回 [结果A]
  - 当输入包含 [条件B] 时，返回 [结果B]
  - 两种情况的返回值必须不同（后续 assert_ne! 会验证）

---

## 测试要求（以下测试代码必须原样实现，断言不得修改）

### 单元测试：精确值验证

```[语言]
// 测试模块 A 的精确输出
[test]
fn test_[模块A]_exact_values() {
    let input = [从 fixture 读取或直接构造];
    let result = [模块A]::process(input);

    assert_eq!(result.[字段1], [期望值1]);
    assert_eq!(result.[字段2], [期望值2]);
    // 守恒约束
    assert_eq!(result.[字段A] + result.[字段B], result.[总量]);
}
```

### 差异化测试：验证不同输入产生不同输出

```[语言]
[test]
fn test_[模块]_output_varies_by_input() {
    let result_a = [模块]::process([输入A]);
    let result_b = [模块]::process([输入B]);

    // [输入A] 和 [输入B] 特征不同，输出必须不同
    assert_ne!(result_a.[关键字段], result_b.[关键字段]);
}
```

### Headless Smoke Test：端到端流程验证

```[语言]
[async_test]
async fn smoke_test_full_pipeline() {
    let mock = Mock[外部依赖]::new();
    let orchestrator = [主流程]::new(mock);

    let result = orchestrator.[主方法]([fixture路径或输入]).await.unwrap();

    // 精确验证聚合数据（来自 fixture 的确定值）
    assert_eq!(result.[总量字段], [精确总量]);
    assert_eq!(result.[子字段1], [精确值1]);

    // 验证各组件的输出都被填充（不允许空值）
    assert!(!result.[组件A输出字段].is_empty());
    // 但同时要验证值本身有意义，不只是非空
    assert!(result.[组件A输出字段].contains([来自输入的关键词]));

    // 守恒验证
    let sum: [类型] = result.items.iter().map(|i| i.[子字段]).sum();
    assert_eq!(sum, result.[总量字段]);
}
```

### 导出/输出测试：验证真实数据进入最终产物

```[语言]
[test]
fn test_output_contains_real_data() {
    let session = [构造包含已知数据的结构体];
    let output = [导出函数](&session);

    assert!(output.contains("[来自session的真实字段值]"));
    assert!(output.contains("Total: [精确数字]"));
}
```

---

## 完成标准

执行以下命令，将完整输出粘贴在回复中：

```bash
grep -rn "todo!\|TODO\|FIXME\|placeholder\|简化版\|WIP" src/
find src/ -name "*.rs" | xargs wc -l | sort -n
cargo build 2>&1
cargo clippy -- -D warnings 2>&1
cargo test 2>&1
```

必须满足：
- grep 输出为空
- 无文件少于 4 行
- build 成功
- clippy 零警告
- **`cargo test` 输出中可见以下测试名称且全部通过**：
  - `test_[模块A]_exact_values`
  - `test_[模块]_output_varies_by_input`
  - `smoke_test_full_pipeline`
  - `test_output_contains_real_data`
- `running 0 tests` 视为失败

import { AnalysisReport, FunctionIR, GeneratedPrompt, Issue } from "../types.js";

export class PromptGenerator {
  generate(report: AnalysisReport): GeneratedPrompt {
    const func = report.function;
    const issues = report.issues;

    const promptSections: string[] = [
      "【函数实现任务】\n",
      `文件：${func.filePath}:${func.lineNumber}`,
      `函数：${func.name}\n`,
    ];

    if (issues.length > 0) {
      promptSections.push("【当前问题】");
      for (const issue of issues) {
        promptSections.push(`❌ ${issue.message}`);
      }
      promptSections.push("");
    }

    promptSections.push("【函数签名】");
    const params = func.signature.parameters.map(p => `${p.name}: ${p.type}`).join(", ");
    promptSections.push(`fn ${func.name}(${params}) -> ${func.signature.returnType}\n`);

    promptSections.push("【必须满足的约束】");
    const constraints = this.generateConstraints(func, issues);
    constraints.forEach((c, i) => promptSections.push(`${i + 1}. ${c}`));
    promptSections.push("");

    promptSections.push("【实现检查点】");
    const checkpoints = this.generateCheckpoints(func, issues);
    checkpoints.forEach(cp => promptSections.push(`□ ${cp}`));
    promptSections.push("");

    promptSections.push("【反模式警告】");
    const antiPatterns = this.generateAntiPatterns(func.metadata.language);
    antiPatterns.forEach(ap => promptSections.push(`- 禁止：${ap}`));

    return {
      prompt: promptSections.join("\n"),
      metadata: {
        complexity: this.estimateComplexity(func, issues),
        estimatedLines: this.estimateLines(func, issues),
      },
      checkpoints,
      antiPatterns,
    };
  }

  private generateConstraints(func: FunctionIR, issues: Issue[]): string[] {
    const constraints: string[] = [];

    const unusedParams = issues.filter(i => i.type === "unused_parameter");
    if (unusedParams.length > 0) {
      const paramNames = unusedParams.map(i => `'${String(i.details.parameterName)}'`).join(", ");
      constraints.push(`参数 ${paramNames} 必须在函数体中被使用`);
    }

    const emptyBodyIssues = issues.filter(i => i.type === "empty_function");
    if (emptyBodyIssues.length > 0) {
      constraints.push("函数体不能为空，必须包含真实实现逻辑");
    }

    const placeholderIssues = issues.filter(i => i.type === "placeholder_return");
    if (placeholderIssues.length > 0) {
      constraints.push("移除所有占位符代码（todo!, unimplemented!, throw new Error 等）");
    }

    constraints.push("禁止使用 _ 前缀来忽略参数");
    constraints.push("错误处理：使用 ? 操作符，禁止 .unwrap() 或 .unwrap_or_default()");

    return constraints;
  }

  private generateCheckpoints(func: FunctionIR, issues: Issue[]): string[] {
    const checkpoints: string[] = [];

    for (const param of func.signature.parameters) {
      checkpoints.push(`参数 '${param.name}' 被使用至少 1 次`);
    }

    checkpoints.push("函数体不为空");
    checkpoints.push("没有 todo!() 或 unimplemented!() 占位符");
    checkpoints.push("错误被正确传播或处理");

    // Add issue-specific checkpoints
    const errorHandlingIssues = issues.filter(i => i.type === "error_handling");
    for (const issue of errorHandlingIssues) {
      checkpoints.push(`修复：${issue.message}`);
    }

    const deadCodeIssues = issues.filter(i => i.type === "dead_code");
    for (const issue of deadCodeIssues) {
      checkpoints.push(`消除死代码：${issue.message}`);
    }

    return checkpoints;
  }

  private generateAntiPatterns(language: string): string[] {
    const common = [
      "空函数体",
      "占位符注释（// TODO, // FIXME）",
      "硬编码的假返回值",
    ];

    if (language === "rust") {
      return [
        ...common,
        "todo!()",
        "unimplemented!()",
        ".unwrap()",
        ".unwrap_or_default()",
        ".unwrap_or(\"\")",
        "_ 前缀参数",
        "let _ = 丢弃计算结果",
      ];
    }

    if (language === "typescript" || language === "javascript") {
      return [
        ...common,
        "throw new Error(\"not implemented\")",
        "throw new Error(\"TODO\")",
        "return null / undefined 作为占位符",
        "as any 绕过类型检查",
        "// @ts-ignore",
      ];
    }

    if (language === "go") {
      return [
        ...common,
        "panic(\"not implemented\")",
        "_ = someFunc() 忽略错误",
        "空的 if err != nil {} 块",
      ];
    }

    if (language === "java") {
      return [
        ...common,
        "throw new UnsupportedOperationException()",
        "return null 作为占位符",
        "空 catch 块",
        "@SuppressWarnings 无理由使用",
      ];
    }

    if (language === "python") {
      return [
        ...common,
        "raise NotImplementedError()",
        "pass 作为函数体",
        "... 作为函数体",
      ];
    }

    return common;
  }

  private estimateComplexity(func: FunctionIR, issues: Issue[]): "low" | "medium" | "high" {
    const paramCount = func.signature.parameters.length;
    const issueCount = issues.length;

    if (paramCount <= 2 && issueCount <= 1) return "low";
    if (paramCount <= 4 && issueCount <= 3) return "medium";
    return "high";
  }

  private estimateLines(func: FunctionIR, issues: Issue[]): number {
    const baseLines = 5;
    const paramLines = func.signature.parameters.length * 2;
    const issueLines = issues.length * 3;
    return baseLines + paramLines + issueLines;
  }
}

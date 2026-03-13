import { AnalysisReport, GeneratedPrompt, Issue } from "../types.js";

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

  private generateConstraints(func: any, issues: Issue[]): string[] {
    const constraints: string[] = [];

    const unusedParams = issues.filter(i => i.type === "unused_parameter");
    if (unusedParams.length > 0) {
      const paramNames = unusedParams.map(i => `'${i.details.parameterName}'`).join(", ");
      constraints.push(`参数 ${paramNames} 必须在函数体中被使用`);
    }

    constraints.push("禁止使用 _ 前缀来忽略参数");
    constraints.push("错误处理：使用 ? 操作符，禁止 .unwrap() 或 .unwrap_or_default()");

    return constraints;
  }

  private generateCheckpoints(func: any, _issues: Issue[]): string[] {
    const checkpoints: string[] = [];

    for (const param of func.signature.parameters) {
      checkpoints.push(`参数 '${param.name}' 被使用至少 1 次`);
    }

    checkpoints.push("函数体不为空");
    checkpoints.push("没有 todo!() 或 unimplemented!() 占位符");
    checkpoints.push("错误被正确传播或处理");

    return checkpoints;
  }

  private generateAntiPatterns(language: string): string[] {
    if (language === "rust") {
      return [
        "todo!()",
        "unimplemented!()",
        ".unwrap()",
        ".unwrap_or_default()",
        "_ 前缀参数",
        "空函数体",
      ];
    }
    return [];
  }

  private estimateComplexity(func: any, issues: Issue[]): "low" | "medium" | "high" {
    const paramCount = func.signature.parameters.length;
    const issueCount = issues.length;

    if (paramCount <= 2 && issueCount <= 1) return "low";
    if (paramCount <= 4 && issueCount <= 3) return "medium";
    return "high";
  }

  private estimateLines(func: any, issues: Issue[]): number {
    const baseLines = 5;
    const paramLines = func.signature.parameters.length * 2;
    const issueLines = issues.length * 3;
    return baseLines + paramLines + issueLines;
  }
}

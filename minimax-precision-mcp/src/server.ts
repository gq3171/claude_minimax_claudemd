import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LanguageDetector } from "./utils/language-detector.js";
import { PlaceholderAnalyzer } from "./analyzers/placeholder.js";
import { ParameterAnalyzer } from "./analyzers/parameter.js";
import { DataFlowAnalyzer } from "./analyzers/dataflow.js";
import { ErrorHandlingAnalyzer } from "./analyzers/error-handling.js";
import { DeadCodeAnalyzer } from "./analyzers/dead-code.js";
import { DependencyAnalyzer } from "./analyzers/dependency.js";
import { PromptGenerator } from "./prompts/generator.js";
import { AnalysisReport, ValidateFileResult, ValidationFinding } from "./types.js";
import * as fs from "fs";
import * as path from "path";

export class MinimaxPrecisionServer {
  private server: Server;
  private languageDetector: LanguageDetector;
  private placeholderAnalyzer: PlaceholderAnalyzer;
  private parameterAnalyzer: ParameterAnalyzer;
  private dataFlowAnalyzer: DataFlowAnalyzer;
  private errorHandlingAnalyzer: ErrorHandlingAnalyzer;
  private deadCodeAnalyzer: DeadCodeAnalyzer;
  private dependencyAnalyzer: DependencyAnalyzer;
  private promptGenerator: PromptGenerator;

  constructor() {
    this.server = new Server(
      {
        name: "minimax-precision-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.languageDetector = new LanguageDetector();
    this.placeholderAnalyzer = new PlaceholderAnalyzer();
    this.parameterAnalyzer = new ParameterAnalyzer();
    this.dataFlowAnalyzer = new DataFlowAnalyzer();
    this.errorHandlingAnalyzer = new ErrorHandlingAnalyzer();
    this.deadCodeAnalyzer = new DeadCodeAnalyzer();
    this.dependencyAnalyzer = new DependencyAnalyzer();
    this.promptGenerator = new PromptGenerator();

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "analyze_function",
          description: "分析指定函数并生成实现提示（支持 Rust, Go, Java, TypeScript, Python）",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
              function_name: { type: "string", description: "函数名称" },
            },
            required: ["file_path", "function_name"],
          },
        },
        {
          name: "scan_placeholders",
          description: "扫描项目中的占位符代码",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "要扫描的目录路径" },
            },
            required: ["path"],
          },
        },
        {
          name: "trace_data_flow",
          description: "追踪数据流，发现未使用的对象",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
            },
            required: ["file_path"],
          },
        },
        {
          name: "validate_implementation",
          description: "验证函数实现是否完整",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
              function_name: { type: "string", description: "函数名称" },
            },
            required: ["file_path", "function_name"],
          },
        },
        {
          name: "check_error_handling",
          description: "检查错误处理问题（.unwrap_or_default, .unwrap_or(\"\") 等）",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
            },
            required: ["file_path"],
          },
        },
        {
          name: "detect_dead_code",
          description: "检测未被调用的函数（死代码）",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
            },
            required: ["file_path"],
          },
        },
        {
          name: "check_dependencies",
          description: "检查函数依赖关系（调用但未定义的函数）",
          inputSchema: {
            type: "object",
            properties: {
              file_path: { type: "string", description: "文件路径" },
            },
            required: ["file_path"],
          },
        },
        {
          name: "validate_file",
          description:
            "【门控工具】对单个文件运行全部质量检查（placeholder、参数、错误处理、死代码、依赖、数据流）。" +
            "返回 passed:true/false。passed:false 时必须修复所有 blockers 再继续，不允许跳过。",
          inputSchema: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "要验证的源代码文件路径",
              },
            },
            required: ["file_path"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "analyze_function":
          return this.handleAnalyzeFunction({
            file_path: this.requireStringArg(args, "file_path"),
            function_name: this.requireStringArg(args, "function_name"),
          });
        case "scan_placeholders":
          return this.handleScanPlaceholders({
            path: this.requireStringArg(args, "path"),
          });
        case "trace_data_flow":
          return this.handleTraceDataFlow({
            file_path: this.requireStringArg(args, "file_path"),
          });
        case "validate_implementation":
          return this.handleValidateImplementation({
            file_path: this.requireStringArg(args, "file_path"),
            function_name: this.requireStringArg(args, "function_name"),
          });
        case "check_error_handling":
          return this.handleCheckErrorHandling({
            file_path: this.requireStringArg(args, "file_path"),
          });
        case "detect_dead_code":
          return this.handleDetectDeadCode({
            file_path: this.requireStringArg(args, "file_path"),
          });
        case "check_dependencies":
          return this.handleCheckDependencies({
            file_path: this.requireStringArg(args, "file_path"),
          });
        case "validate_file":
          return this.handleValidateFile({
            file_path: this.requireStringArg(args, "file_path"),
          });
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  /** Extract a required non-empty string argument, throwing on missing/wrong type. */
  private requireStringArg(
    args: Record<string, unknown> | undefined,
    key: string
  ): string {
    const val = args?.[key];
    if (typeof val !== "string" || val.length === 0) {
      throw new Error(
        `Tool argument '${key}' must be a non-empty string, got: ${JSON.stringify(val)}`
      );
    }
    return val;
  }

  private async handleAnalyzeFunction(args: { file_path: string; function_name: string }) {
    try {
      const { file_path, function_name } = args;
      const functions = this.languageDetector.parseFile(file_path);
      const targetFunc = functions.find((f) => f.name === function_name);

      if (!targetFunc) {
        return {
          content: [{ type: "text", text: `函数 '${function_name}' 未找到` }],
        };
      }

      const placeholderIssues = this.placeholderAnalyzer.analyze(targetFunc);
      const parameterIssues = this.parameterAnalyzer.analyze(targetFunc);
      const allIssues = [...placeholderIssues, ...parameterIssues];

      const report: AnalysisReport = {
        function: targetFunc,
        issues: allIssues,
        context: { callers: [], callees: [] },
      };

      const prompt = this.promptGenerator.generate(report);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issues: allIssues,
                precise_prompt: prompt.prompt,
                metadata: prompt.metadata,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to analyze function: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleScanPlaceholders(args: { path: string }) {
    try {
      const { path: scanPath } = args;
      const files = this.findSourceFiles(scanPath);
      const allIssues: Array<{ file: string; line: number; function: string; type: string }> = [];

      for (const file of files) {
        const functions = this.languageDetector.parseFile(file);
        for (const func of functions) {
          const issues = this.placeholderAnalyzer.analyze(func);
          for (const issue of issues) {
            allIssues.push({
              file: func.filePath,
              line: func.lineNumber,
              function: func.name,
              type: issue.type,
            });
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                placeholders: allIssues,
                statistics: {
                  total_files: files.length,
                  placeholder_count: allIssues.length,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to scan placeholders: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleTraceDataFlow(args: { file_path: string }) {
    try {
      const { file_path } = args;
      const functions = this.languageDetector.parseFile(file_path);
      const issues = this.dataFlowAnalyzer.analyzeFile(file_path, functions);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ dead_code: issues }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to trace data flow: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleValidateImplementation(args: { file_path: string; function_name: string }) {
    try {
      const { file_path, function_name } = args;
      const functions = this.languageDetector.parseFile(file_path);
      const targetFunc = functions.find((f) => f.name === function_name);

      if (!targetFunc) {
        return {
          content: [{ type: "text", text: `函数 '${function_name}' 未找到` }],
        };
      }

      const placeholderIssues = this.placeholderAnalyzer.analyze(targetFunc);
      const parameterIssues = this.parameterAnalyzer.analyze(targetFunc);
      const allIssues = [...placeholderIssues, ...parameterIssues];

      const score = Math.max(0, 10 - allIssues.length * 2);
      const isComplete = score >= 9;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                is_complete: isComplete,
                violations: allIssues.map((i) => ({
                  rule: i.type,
                  violated: true,
                  details: i.message,
                })),
                score,
                threshold: 9.0,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to validate implementation: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleCheckErrorHandling(args: { file_path: string }) {
    try {
      const { file_path } = args;
      const sourceCode = fs.readFileSync(file_path, 'utf-8');
      const issues = this.errorHandlingAnalyzer.analyze(sourceCode, file_path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error_handling_issues: issues }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to check error handling: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleDetectDeadCode(args: { file_path: string }) {
    try {
      const { file_path } = args;
      const sourceCode = fs.readFileSync(file_path, 'utf-8');
      const issues = this.deadCodeAnalyzer.analyze(sourceCode, file_path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ dead_code_issues: issues }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to detect dead code: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleCheckDependencies(args: { file_path: string }) {
    try {
      const { file_path } = args;
      const sourceCode = fs.readFileSync(file_path, 'utf-8');
      const issues = this.dependencyAnalyzer.analyze(sourceCode, file_path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ dependency_issues: issues }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Failed to check dependencies: ${error}` }, null, 2),
          },
        ],
      };
    }
  }

  private async handleValidateFile(args: { file_path: string }) {
    try {
      const { file_path } = args;
      const result = this.runValidateFile(file_path);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: `Failed to validate file: ${error}` },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  /**
   * Core gate logic: runs every analyzer on the file, aggregates findings, and
   * returns a unified ValidateFileResult.  passed === false means the model MUST
   * fix all blockers before proceeding — this is the primary enforcement point.
   */
  private runValidateFile(filePath: string): ValidateFileResult {
    const language = this.languageDetector.detectLanguage(filePath) ?? "unknown";
    const findings: ValidationFinding[] = [];

    // ── 1. Parse file into function IR ────────────────────────────────────────
    let functions: ReturnType<typeof this.languageDetector.parseFile>;
    try {
      functions = this.languageDetector.parseFile(filePath);
    } catch (err) {
      throw new Error(`Cannot parse '${filePath}': ${err}`);
    }

    // ── 2. Per-function checks (placeholder + unused parameters) ──────────────
    for (const func of functions) {
      // Placeholder / empty body
      const placeholderIssues = this.placeholderAnalyzer.analyze(func);
      for (const issue of placeholderIssues) {
        findings.push({
          category: issue.type === "empty_function" ? "placeholder" : "placeholder",
          severity: issue.severity,
          location: `${issue.location.file}:${issue.location.line}`,
          message: issue.message,
        });
      }

      // Unused parameters (may throw if file unreadable — caught by outer try)
      try {
        const paramIssues = this.parameterAnalyzer.analyze(func);
        for (const issue of paramIssues) {
          findings.push({
            category: "unused_parameter",
            severity: issue.severity,
            location: `${issue.location.file}:${issue.location.line}`,
            message: issue.message,
          });
        }
      } catch {
        // Parameter analysis is best-effort; skip if unsupported language/error
      }
    }

    // ── 3. File-level checks ──────────────────────────────────────────────────
    let sourceCode: string;
    try {
      sourceCode = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      throw new Error(`Cannot read '${filePath}': ${err}`);
    }

    // Error handling antipatterns
    const errorIssues = this.errorHandlingAnalyzer.analyze(sourceCode, filePath);
    for (const issue of errorIssues) {
      findings.push({
        category: "error_handling",
        severity: issue.severity,
        location: `${issue.location.file}:${issue.location.line}`,
        message: issue.message,
        suggestion: issue.suggestion,
      });
    }

    // Dead code (public functions never called)
    const deadIssues = this.deadCodeAnalyzer.analyze(sourceCode, filePath);
    for (const issue of deadIssues) {
      findings.push({
        category: "dead_code",
        severity: issue.severity,
        location: `${issue.location.file}:${issue.location.line}`,
        message: issue.message,
        suggestion: issue.suggestion,
      });
    }

    // Missing dependencies
    const depIssues = this.dependencyAnalyzer.analyze(sourceCode, filePath);
    for (const issue of depIssues) {
      findings.push({
        category: "missing_dependency",
        severity: issue.severity,
        location: `${issue.location.file}:${issue.location.line}`,
        message: issue.message,
        suggestion: issue.suggestion,
      });
    }

    // Data flow: constructed-but-unused objects
    if (functions.length > 0) {
      try {
        const dataFlowIssues = this.dataFlowAnalyzer.analyzeFile(filePath, functions);
        for (const issue of dataFlowIssues) {
          findings.push({
            category: "data_flow",
            severity: issue.severity,
            location: `${issue.location.file}:${issue.location.line}`,
            message: issue.message,
          });
        }
      } catch {
        // Data flow is best-effort
      }
    }

    // ── 4. Aggregate ─────────────────────────────────────────────────────────
    const blockers = findings.filter(
      (f) => f.severity === "critical" || f.severity === "error"
    );
    const warnings = findings.filter((f) => f.severity === "warning");

    const byCategory = {
      placeholders: findings.filter((f) => f.category === "placeholder").length,
      unused_parameters: findings.filter((f) => f.category === "unused_parameter").length,
      error_handling: findings.filter((f) => f.category === "error_handling").length,
      dead_code: findings.filter((f) => f.category === "dead_code").length,
      missing_dependencies: findings.filter((f) => f.category === "missing_dependency").length,
      data_flow: findings.filter((f) => f.category === "data_flow").length,
    };

    const passed = blockers.length === 0;
    const verdict = passed
      ? `✅ PASSED — ${filePath} (${functions.length} functions, ${warnings.length} warnings)`
      : `❌ BLOCKED — ${filePath}: ${blockers.length} blocker(s) must be fixed before proceeding`;

    return {
      passed,
      file: filePath,
      language,
      functions_checked: functions.length,
      total_issues: findings.length,
      blockers,
      warnings,
      by_category: byCategory,
      verdict,
    };
  }

  private findSourceFiles(dir: string, depth: number = 0): string[] {
    const MAX_DEPTH = 20;
    if (depth > MAX_DEPTH) return [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Cannot read directory '${dir}': ${err}`);
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          files.push(...this.findSourceFiles(fullPath, depth + 1));
        } catch {
          // Skip unreadable subdirectories without aborting the whole scan
        }
      } else if (entry.isFile()) {
        const lang = this.languageDetector.detectLanguage(fullPath);
        if (lang) files.push(fullPath);
      }
    }

    return files;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

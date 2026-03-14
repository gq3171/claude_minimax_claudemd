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
import { AnalysisReport } from "./types.js";
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "analyze_function":
          return this.handleAnalyzeFunction(args as any);
        case "scan_placeholders":
          return this.handleScanPlaceholders(args as any);
        case "trace_data_flow":
          return this.handleTraceDataFlow(args as any);
        case "validate_implementation":
          return this.handleValidateImplementation(args as any);
        case "check_error_handling":
          return this.handleCheckErrorHandling(args as any);
        case "detect_dead_code":
          return this.handleDetectDeadCode(args as any);
        case "check_dependencies":
          return this.handleCheckDependencies(args as any);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleAnalyzeFunction(args: { file_path: string; function_name: string }) {
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
  }

  private async handleScanPlaceholders(args: { path: string }) {
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
  }

  private async handleTraceDataFlow(args: { file_path: string }) {
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
  }

  private async handleValidateImplementation(args: { file_path: string; function_name: string }) {
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
  }

  private async handleCheckErrorHandling(args: { file_path: string }) {
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
  }

  private async handleDetectDeadCode(args: { file_path: string }) {
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
  }

  private async handleCheckDependencies(args: { file_path: string }) {
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
  }

  private findSourceFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findSourceFiles(fullPath));
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

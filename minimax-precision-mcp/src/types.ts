export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface Parameter {
  name: string;
  type: string;
  isUsed: boolean;
  usageLocations: Location[];
}

export interface FunctionIR {
  name: string;
  filePath: string;
  lineNumber: number;
  signature: {
    parameters: Parameter[];
    returnType: string;
  };
  body: {
    isEmpty: boolean;
    hasPlaceholder: boolean;
  };
  metadata: {
    language: string;
    isAsync: boolean;
  };
}

export type IssueType =
  | "unused_parameter"
  | "unused_variable"
  | "empty_function"
  | "placeholder_return"
  | "ignored_error"
  | "dead_code"
  | "error_handling"
  | "missing_dependency";

export interface Issue {
  type: IssueType;
  severity: "critical" | "error" | "warning";
  location: Location;
  message: string;
  details: Record<string, unknown>;
}

export interface AnalysisIssue {
  type: IssueType;
  message: string;
  location: { file: string; line: number };
  severity: "critical" | "error" | "warning";
  suggestion: string;
}

export interface AnalysisReport {
  function: FunctionIR;
  issues: Issue[];
  context: {
    callers: string[];
    callees: string[];
  };
}

export interface GeneratedPrompt {
  prompt: string;
  metadata: {
    complexity: "low" | "medium" | "high";
    estimatedLines: number;
  };
  checkpoints: string[];
  antiPatterns: string[];
}

/** A single normalized finding from any of the analyzers, used in ValidateFileResult. */
export interface ValidationFinding {
  /** Which analyzer produced this finding */
  category:
    | "placeholder"
    | "unused_parameter"
    | "error_handling"
    | "dead_code"
    | "missing_dependency"
    | "data_flow";
  severity: "critical" | "error" | "warning";
  /** File:line reference */
  location: string;
  message: string;
  suggestion?: string;
}

/**
 * Return type of the `validate_file` gate tool.
 * `passed` is false when any blocker (critical/error severity) exists.
 */
export interface ValidateFileResult {
  passed: boolean;
  file: string;
  language: string;
  functions_checked: number;
  total_issues: number;
  /** Issues with severity critical|error — MUST be fixed before proceeding */
  blockers: ValidationFinding[];
  /** Issues with severity warning — reported but do not block */
  warnings: ValidationFinding[];
  by_category: {
    placeholders: number;
    unused_parameters: number;
    error_handling: number;
    dead_code: number;
    missing_dependencies: number;
    data_flow: number;
  };
  /** One-line human-readable verdict */
  verdict: string;
}

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

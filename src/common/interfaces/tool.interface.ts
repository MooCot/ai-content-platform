export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  success: boolean;
  result: unknown;
  error?: string;
}

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // JSON Schema

  execute(input: ToolInput): Promise<ToolOutput>;
}

export const TOOLS_TOKEN = 'TOOLS';

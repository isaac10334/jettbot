import { ToolRegistry, type ToolDefinition } from "./ToolRegistry";

export interface ToolService {
  readonly registerTool: <TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>) => void;
  readonly listTools: () => readonly ToolDefinition[];
  readonly callTool: (name: string, input: unknown) => Promise<unknown>;
}

export const createToolService = (): ToolService => {
  const registry = new ToolRegistry();
  return {
    registerTool: (tool) => registry.register(tool),
    listTools: () => registry.list(),
    callTool: (name, input) => registry.call(name, input),
  };
};


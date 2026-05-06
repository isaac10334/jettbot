import type { ToolDefinition } from "../ToolRegistry";

export const createPingTool = (): ToolDefinition<void, { readonly pong: true }> => ({
  name: "ping",
  description: "Returns pong.",
  call: async () => ({ pong: true }),
});


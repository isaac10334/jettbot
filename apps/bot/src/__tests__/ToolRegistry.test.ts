import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "../tools/ToolRegistry";

describe("ToolRegistry", () => {
  test("registers and calls tools", async () => {
    const registry = new ToolRegistry();
    registry.register({ name: "ping", description: "ping", call: async () => "pong" });
    expect(await registry.call("ping", undefined)).toBe("pong");
  });

  test("rejects unknown tools", async () => {
    const registry = new ToolRegistry();
    await expect(registry.call("missing", undefined)).rejects.toThrow("Unknown tool");
  });
});


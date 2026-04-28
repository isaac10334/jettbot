import { describe, expect, test } from "bun:test";
import { encodeJsonLine, JsonLineParser } from "../__internal/JsonLineProtocol";

describe("JsonLineProtocol", () => {
  test("encodes one JSON object per line", () => {
    expect(encodeJsonLine({ type: "Ready" })).toBe('{"type":"Ready"}\n');
  });

  test("parses split chunks", () => {
    const messages: unknown[] = [];
    const parser = new JsonLineParser((message) => messages.push(message), (error) => {
      throw error;
    });
    parser.push('{"a":');
    parser.push("1}\n");
    expect(messages).toEqual([{ a: 1 }]);
  });
});


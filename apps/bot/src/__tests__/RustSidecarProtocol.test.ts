import { describe, expect, test } from "bun:test";
import { validateSidecarMessage } from "../sidecar/RustSidecarProtocol";

describe("RustSidecarProtocol", () => {
  test("accepts sidecar event shape", () => {
    expect(validateSidecarMessage({ type: "Ready" })).toEqual({ type: "Ready" });
  });

  test("accepts voice debug event shape", () => {
    expect(validateSidecarMessage({ type: "VoiceDebug", stage: "receive_enabled", message: "enabled" })).toEqual({
      type: "VoiceDebug",
      stage: "receive_enabled",
      message: "enabled",
    });
  });

  test("rejects missing type", () => {
    expect(() => validateSidecarMessage({})).toThrow();
  });
});

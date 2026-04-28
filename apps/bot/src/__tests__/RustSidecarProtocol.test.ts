import { describe, expect, test } from "bun:test";
import { validateSidecarMessage } from "../sidecar/RustSidecarProtocol";

describe("RustSidecarProtocol", () => {
  test("accepts sidecar event shape", () => {
    expect(validateSidecarMessage({ type: "Ready" })).toEqual({ type: "Ready" });
  });

  test("rejects missing type", () => {
    expect(() => validateSidecarMessage({})).toThrow();
  });
});


import { describe, expect, test } from "bun:test";
import { shouldPromoteSidecarLine } from "../sidecar/RustSidecarService";

describe("RustSidecarService", () => {
  test("keeps noisy Songbird receive decode warnings out of the console", () => {
    expect(shouldPromoteSidecarLine(
      "2026-05-05T19:16:34.211229Z  WARN songbird::driver::tasks::udp_rx: Decode error for SSRC 18101: Other",
      "warn",
    )).toBe(false);
    expect(shouldPromoteSidecarLine(
      "2026-05-05T19:16:34.211229Z  WARN songbird::driver::tasks::udp_rx::ssrc_state: Failed to decode received packet",
      "warn",
    )).toBe(false);
  });

  test("still promotes actionable sidecar warnings", () => {
    expect(shouldPromoteSidecarLine(
      "2026-05-05T19:16:34.211229Z  WARN jettbot_voice_sidecar: playback underrun",
      "warn",
    )).toBe(true);
  });
});

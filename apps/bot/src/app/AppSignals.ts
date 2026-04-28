import { createSignal, type Signal } from "@loop-kit/common/Signal";
import type { SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

export interface AppSignals {
  readonly sidecarEvent: Signal<SidecarEvent>;
  readonly transcriptTurn: Signal<TranscriptTurn>;
  readonly conversationTurnReady: Signal<TranscriptTurn>;
  readonly aiToken: Signal<string>;
  readonly aiResponseComplete: Signal<string>;
}

export const createAppSignals = (): AppSignals => ({
  sidecarEvent: createSignal<SidecarEvent>(),
  transcriptTurn: createSignal<TranscriptTurn>(),
  conversationTurnReady: createSignal<TranscriptTurn>(),
  aiToken: createSignal<string>(),
  aiResponseComplete: createSignal<string>(),
});


import { createSignal, type Signal } from "@loop-kit/common/Signal";
import type { SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

export interface AiResponseCompleteSignal {
  readonly text: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly decisionId?: string;
  readonly priority?: string;
  readonly interruptMode?: string;
  readonly responseId?: string;
}

export interface AppSignals {
  readonly sidecarEvent: Signal<SidecarEvent>;
  readonly transcriptTurn: Signal<TranscriptTurn>;
  readonly conversationTurnReady: Signal<TranscriptTurn>;
  readonly aiToken: Signal<string>;
  readonly aiResponseComplete: Signal<AiResponseCompleteSignal>;
}

export const createAppSignals = (): AppSignals => ({
  sidecarEvent: createSignal<SidecarEvent>(),
  transcriptTurn: createSignal<TranscriptTurn>(),
  conversationTurnReady: createSignal<TranscriptTurn>(),
  aiToken: createSignal<string>(),
  aiResponseComplete: createSignal<AiResponseCompleteSignal>(),
});

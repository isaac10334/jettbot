import { createSignal, type Signal } from "@loop-kit/common/Signal";

export interface TranscriptTurn {
  readonly guildId: string;
  readonly channelId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly username?: string;
  readonly text: string;
  readonly startMs?: number;
  readonly endMs?: number;
  readonly isFinal: boolean;
  readonly receivedAt: number;
}

export interface TranscriptStitcherService {
  readonly turns: readonly TranscriptTurn[];
  readonly conversationTurnReady: Signal<TranscriptTurn>;
  readonly acceptTurn: (turn: TranscriptTurn) => void;
  readonly recentContext: (limit?: number) => readonly TranscriptTurn[];
}

export const createTranscriptStitcherService = (): TranscriptStitcherService => {
  const timeline: TranscriptTurn[] = [];
  const conversationTurnReady = createSignal<TranscriptTurn>();
  return {
    get turns() {
      return timeline;
    },
    conversationTurnReady,
    acceptTurn: (turn) => {
      timeline.push(turn);
      if (turn.isFinal && turn.text.trim().length > 0) conversationTurnReady.emit(turn);
    },
    recentContext: (limit = 20) => timeline.slice(-limit),
  };
};

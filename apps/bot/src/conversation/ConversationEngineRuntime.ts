import { createSignal, type Signal } from "@loop-kit/common/Signal";
import { createStore, type Store } from "@loop-kit/common/Store";
import type { SidecarEvent } from "../sidecar/RustSidecarProtocol";
import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

export type BotSpeechStatus = "idle" | "thinking" | "speaking" | "queued" | "interrupted";
export type ConversationDecisionKind =
  | "ignore"
  | "wait"
  | "speak"
  | "queueSpeech"
  | "interruptSelf"
  | "refuseInterruption"
  | "updateWorkingContext";
export type SpeechPriority = "normal" | "high";
export type SpeechInterruptMode = "queue" | "finish_sentence_then_listen" | "non_interruptible";

export interface SpeechJob {
  readonly guildId: string;
  readonly channelId?: string;
  readonly turnId?: string;
  readonly decisionId?: string;
  readonly speechId: string;
  readonly priority: SpeechPriority;
  readonly interruptMode: SpeechInterruptMode;
  readonly text: string;
  readonly status: "queued" | "speaking" | "finished" | "failed" | "interrupted";
}

export interface ConversationEngineGuildState {
  readonly guildId: string;
  readonly botSpeechStatus: BotSpeechStatus;
  readonly activeSpeechId?: string;
  readonly queuedSpeechIds: readonly string[];
  readonly lastDecisionId?: string;
  readonly lastTranscriptTurnId?: string;
}

export interface ConversationEngineState {
  readonly guilds: Record<string, ConversationEngineGuildState>;
}

export interface ConversationDecision {
  readonly id: string;
  readonly kind: ConversationDecisionKind;
  readonly guildId: string;
  readonly channelId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly turn?: TranscriptTurn;
  readonly priority: SpeechPriority;
  readonly interruptMode: SpeechInterruptMode;
  readonly reason: string;
  readonly createdAt: number;
  readonly decisionStartAt: number;
  readonly decisionFinishedAt: number;
}

export interface ConversationEngineRuntime {
  readonly state: Store<ConversationEngineState>;
  readonly decisions: Signal<ConversationDecision>;
  readonly ingestTranscriptTurn: (turn: TranscriptTurn) => ConversationDecision;
  readonly ingestPlaybackEvent: (event: SidecarEvent) => void;
  readonly markThinking: (guildId: string) => void;
  readonly enqueueSpeechJob: (job: SpeechJob) => void;
  readonly markSpeechStarted: (guildId: string, speechId: string) => void;
  readonly markSpeechFinished: (guildId: string, speechId: string) => void;
  readonly markSpeechFailed: (guildId: string, speechId: string) => void;
  readonly interruptSelf: (guildId: string) => void;
}

const directAddressPattern = /\b(jettbot|jetbot|jett bot|jet bot|jetpack|jet pack)\b/i;
const stopPattern = /\b(stop|cancel|shut up|quiet|be quiet|hold on)\b/i;
const multiSpeakerWaitWindowMs = 900;

const turnId = (turn: TranscriptTurn): string =>
  `${turn.sessionId}:${turn.userId}:${turn.receivedAt}:${turn.startMs ?? 0}:${turn.endMs ?? 0}`;

const getGuildState = (state: ConversationEngineState, guildId: string): ConversationEngineGuildState =>
  state.guilds[guildId] ?? { guildId, botSpeechStatus: "idle", queuedSpeechIds: [] };

const setGuildState = (
  store: Store<ConversationEngineState>,
  guildId: string,
  update: (guild: ConversationEngineGuildState) => ConversationEngineGuildState,
): void => {
  store.update((state) => ({
    guilds: {
      ...state.guilds,
      [guildId]: update(getGuildState(state, guildId)),
    },
  }));
};

const withoutActiveSpeech = (guild: ConversationEngineGuildState): Omit<ConversationEngineGuildState, "activeSpeechId"> => {
  const { activeSpeechId: _activeSpeechId, ...rest } = guild;
  return rest;
};

export const createConversationEngineRuntime = (): ConversationEngineRuntime => {
  const state = createStore<ConversationEngineState>({ guilds: {} });
  const decisions = createSignal<ConversationDecision>();
  const recentFinalTurns = new Map<string, TranscriptTurn[]>();

  const makeDecision = (
    turn: TranscriptTurn,
    kind: ConversationDecisionKind,
    reason: string,
    startedAt: number,
  ): ConversationDecision => ({
    id: crypto.randomUUID(),
    kind,
    guildId: turn.guildId,
    channelId: turn.channelId,
    sessionId: turn.sessionId,
    turnId: turnId(turn),
    turn,
    priority: kind === "interruptSelf" ? "high" : "normal",
    interruptMode: kind === "interruptSelf" ? "finish_sentence_then_listen" : "queue",
    reason,
    createdAt: Date.now(),
    decisionStartAt: startedAt,
    decisionFinishedAt: Date.now(),
  });

  const publish = (decision: ConversationDecision): ConversationDecision => {
    setGuildState(state, decision.guildId, (guild) => ({
      ...guild,
      lastDecisionId: decision.id,
      ...(decision.turnId ? { lastTranscriptTurnId: decision.turnId } : {}),
    }));
    decisions.emit(decision);
    return decision;
  };

  return {
    state,
    decisions,
    ingestTranscriptTurn: (turn) => {
      const startedAt = Date.now();
      if (!turn.isFinal || turn.text.trim().length === 0) {
        return publish(makeDecision(turn, "updateWorkingContext", "non-final or empty transcript", startedAt));
      }
      if (turn.userId.startsWith("unknown_ssrc:")) {
        return publish(makeDecision(turn, "ignore", "diagnostic unknown SSRC transcript", startedAt));
      }

      const recent = recentFinalTurns.get(turn.guildId) ?? [];
      const recentDifferentSpeaker = recent.some((item) =>
        item.userId !== turn.userId && turn.receivedAt - item.receivedAt <= multiSpeakerWaitWindowMs
      );
      recentFinalTurns.set(turn.guildId, [...recent, turn].slice(-12));

      const guild = getGuildState(state.get(), turn.guildId);
      const addressed = directAddressPattern.test(turn.text);
      const stopRequested = stopPattern.test(turn.text);

      if (stopRequested && (guild.botSpeechStatus === "speaking" || guild.botSpeechStatus === "queued")) {
        return publish(makeDecision(turn, "interruptSelf", "user requested stop while Jettbot speech was active", startedAt));
      }
      if (recentDifferentSpeaker && !addressed) {
        return publish(makeDecision(turn, "wait", "multiple known speakers are active in a short window", startedAt));
      }
      if (!addressed) {
        return publish(makeDecision(turn, "ignore", "Jettbot was not directly addressed", startedAt));
      }
      if (guild.botSpeechStatus === "speaking" || guild.botSpeechStatus === "queued") {
        return publish(makeDecision(turn, "queueSpeech", "Jettbot is already speaking or queued", startedAt));
      }
      return publish(makeDecision(turn, "speak", "Jettbot was directly addressed", startedAt));
    },
    ingestPlaybackEvent: (event) => {
      if ((event.type === "PlaybackFinished" || event.type === "PlaybackDebug") && "guild_id" in event && event.guild_id) {
      if (event.type === "PlaybackFinished" || (event.type === "PlaybackDebug" && event.stage === "end")) {
        setGuildState(state, event.guild_id, (guild) => ({
            ...withoutActiveSpeech(guild),
            botSpeechStatus: guild.queuedSpeechIds.length > 0 ? "queued" : "idle",
          }));
        }
      }
    },
    markThinking: (guildId) => {
      setGuildState(state, guildId, (guild) => ({
        ...guild,
        botSpeechStatus: guild.botSpeechStatus === "idle" ? "thinking" : guild.botSpeechStatus,
      }));
    },
    enqueueSpeechJob: (job) => {
      setGuildState(state, job.guildId, (guild) => ({
        ...guild,
        botSpeechStatus: guild.botSpeechStatus === "idle" ? "queued" : guild.botSpeechStatus,
        queuedSpeechIds: [...guild.queuedSpeechIds, job.speechId],
      }));
    },
    markSpeechStarted: (guildId, speechId) => {
      setGuildState(state, guildId, (guild) => ({
        ...guild,
        botSpeechStatus: "speaking",
        activeSpeechId: speechId,
        queuedSpeechIds: guild.queuedSpeechIds.filter((id) => id !== speechId),
      }));
    },
    markSpeechFinished: (guildId, speechId) => {
      setGuildState(state, guildId, (guild) => {
        if (guild.activeSpeechId !== speechId) {
          return {
            ...guild,
            botSpeechStatus: guild.queuedSpeechIds.length > 0 ? "queued" : "idle",
          };
        }
        return {
          ...withoutActiveSpeech(guild),
          botSpeechStatus: guild.queuedSpeechIds.length > 0 ? "queued" : "idle",
        };
      });
    },
    markSpeechFailed: (guildId, speechId) => {
      setGuildState(state, guildId, (guild) => {
        const base = guild.activeSpeechId === speechId ? withoutActiveSpeech(guild) : guild;
        return {
          ...base,
          botSpeechStatus: guild.queuedSpeechIds.length > 0 ? "queued" : "idle",
          queuedSpeechIds: guild.queuedSpeechIds.filter((id) => id !== speechId),
        };
      });
    },
    interruptSelf: (guildId) => {
      setGuildState(state, guildId, (guild) => ({
        ...withoutActiveSpeech(guild),
        botSpeechStatus: "interrupted",
        queuedSpeechIds: [],
      }));
    },
  };
};

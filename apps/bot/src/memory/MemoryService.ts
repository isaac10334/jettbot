import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

export interface MemoryMessage {
  readonly sourceId?: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly text: string;
  readonly createdAt: number;
}

export type MemoryKind = "semantic" | "procedural";

export interface RawObservation {
  readonly id?: string;
  readonly kind: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly sourceId?: string;
  readonly text?: string;
  readonly payload?: unknown;
  readonly confidence?: number;
  readonly importance?: number;
  readonly createdAtMs?: number;
}

export interface MemoryItem {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly confidence: number;
  readonly importance: number;
  readonly status: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface AddMemoryInput {
  readonly kind: MemoryKind;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly provenanceObservationId?: string;
}

export interface MemorySearchOptions {
  readonly limit?: number;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly kind?: MemoryKind;
}

export interface MemoryService {
  readonly initialize: () => Promise<void>;
  readonly saveMessage: (memory: MemoryMessage) => Promise<void>;
  readonly saveTranscriptTurn: (turn: TranscriptTurn) => Promise<void>;
  readonly observeRaw: (observation: RawObservation) => Promise<string>;
  readonly addMemory: (memory: AddMemoryInput) => Promise<MemoryItem>;
  readonly searchMemoryItems: (query: string, options?: MemorySearchOptions) => Promise<readonly MemoryItem[]>;
  readonly recentMemoryItems: (options?: MemorySearchOptions) => Promise<readonly MemoryItem[]>;
  readonly search: (query: string, options?: { readonly limit?: number; readonly guildId?: string }) => Promise<readonly MemoryMessage[]>;
  readonly semanticSearch: (query: string, options?: { readonly limit?: number; readonly guildId?: string }) => Promise<readonly MemoryMessage[]>;
  readonly getRecentConversation: (guildId?: string, channelId?: string, userId?: string) => Promise<readonly MemoryMessage[]>;
  readonly setSelfState: (scopeKey: string, kind: string, value: unknown, options?: { readonly guildId?: string; readonly userId?: string }) => Promise<void>;
  readonly getSelfState: (scopeKey: string) => Promise<unknown | undefined>;
  readonly setPersonalityProfile: (profileId: string, options?: { readonly guildId?: string; readonly userId?: string }) => Promise<void>;
  readonly getPersonalityProfile: (options?: { readonly guildId?: string; readonly userId?: string }) => Promise<string | undefined>;
  readonly summarizeSession: () => Promise<string>;
  readonly close: () => void;
}

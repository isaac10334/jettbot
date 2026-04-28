import type { TranscriptTurn } from "../transcription/TranscriptStitcherService";

export interface MemoryMessage {
  readonly guildId?: string;
  readonly channelId?: string;
  readonly userId?: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface MemoryService {
  readonly initialize: () => Promise<void>;
  readonly saveMessage: (memory: MemoryMessage) => Promise<void>;
  readonly saveTranscriptTurn: (turn: TranscriptTurn) => Promise<void>;
  readonly search: (query: string, options?: { readonly limit?: number }) => Promise<readonly MemoryMessage[]>;
  readonly semanticSearch: (query: string, options?: { readonly limit?: number }) => Promise<readonly MemoryMessage[]>;
  readonly getRecentConversation: (guildId?: string, channelId?: string, userId?: string) => Promise<readonly MemoryMessage[]>;
  readonly summarizeSession: () => Promise<string>;
  readonly close: () => void;
}


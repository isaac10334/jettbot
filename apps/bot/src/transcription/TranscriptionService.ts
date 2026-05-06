export interface StreamingTranscriptionSession {
  readonly userId: string;
  readonly sendAudio: (chunk: Uint8Array) => void;
  readonly close: () => Promise<void>;
}

export interface TranscriptionSessionMessageEvent {
  readonly type: "message";
  readonly messageType?: string;
  readonly transcriptLength?: number;
  readonly endOfTurn?: boolean;
  readonly turnIsFormatted?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly code?: string | number;
}

export type TranscriptionSessionEvent =
  | { readonly type: "open" }
  | TranscriptionSessionMessageEvent
  | { readonly type: "message_parse_error"; readonly error: string; readonly preview: string }
  | { readonly type: "error"; readonly error: string }
  | { readonly type: "close"; readonly code: number; readonly reason: string };

export interface TranscriptionService {
  readonly createStreamingSession: (input: {
    readonly userId: string;
    readonly prompt: string;
    readonly sampleRate: number;
    readonly onTurn: (turn: { readonly text: string; readonly isFinal: boolean; readonly startMs?: number; readonly endMs?: number }) => void;
    readonly onSessionEvent?: (event: TranscriptionSessionEvent) => void;
  }) => Promise<StreamingTranscriptionSession>;
}

export interface StreamingTranscriptionSession {
  readonly userId: string;
  readonly sendAudio: (chunk: Uint8Array) => void;
  readonly close: () => Promise<void>;
}

export interface TranscriptionService {
  readonly createStreamingSession: (input: {
    readonly userId: string;
    readonly prompt: string;
    readonly sampleRate: number;
    readonly onTurn: (turn: { readonly text: string; readonly isFinal: boolean; readonly startMs?: number; readonly endMs?: number }) => void;
  }) => Promise<StreamingTranscriptionSession>;
}


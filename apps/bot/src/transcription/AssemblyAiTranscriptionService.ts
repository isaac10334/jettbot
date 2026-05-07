import { createHash } from "node:crypto";
import type { Env } from "../Env";
import type { StreamingTranscriptionSession, TranscriptionService, TranscriptionSessionMessageEvent } from "./TranscriptionService";

interface AssemblyAiMessage {
  readonly type?: string;
  readonly transcript?: string;
  readonly end_of_turn?: boolean;
  readonly turn_is_formatted?: boolean;
  readonly error?: string;
  readonly message?: string;
  readonly code?: string | number;
  readonly words?: Array<{ readonly start?: number; readonly end?: number }>;
}

const previewText = (text: string): string => text.slice(0, 200);

export const summarizeTranscriptionPrompt = (prompt: string): {
  readonly promptLength: number;
  readonly promptSha256?: string;
  readonly promptPreview?: string;
} => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { promptLength: 0 };
  return {
    promptLength: trimmed.length,
    promptSha256: createHash("sha256").update(trimmed).digest("hex"),
    promptPreview: previewText(trimmed),
  };
};

const readMessageText = async (data: unknown): Promise<string> => {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return await data.text();
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
};

export const summarizeAssemblyAiMessage = (data: AssemblyAiMessage): TranscriptionSessionMessageEvent => ({
  type: "message",
  ...(data.type ? { messageType: data.type } : {}),
  ...(data.transcript != null ? { transcriptLength: data.transcript.length } : {}),
  ...(data.end_of_turn != null ? { endOfTurn: data.end_of_turn } : {}),
  ...(data.turn_is_formatted != null ? { turnIsFormatted: data.turn_is_formatted } : {}),
  ...(data.error != null ? { error: data.error } : {}),
  ...(data.message != null ? { message: data.message } : {}),
  ...(data.code != null ? { code: data.code } : {}),
});

export const createAssemblyAiTranscriptionService = (env: Env): TranscriptionService => ({
  createStreamingSession: async ({ userId, prompt, sampleRate, onTurn, onSessionEvent }): Promise<StreamingTranscriptionSession> => {
    const url = new URL("wss://streaming.assemblyai.com/v3/ws");
    url.searchParams.set("sample_rate", String(sampleRate));
    url.searchParams.set("speech_model", env.ASSEMBLYAI_SPEECH_MODEL);
    url.searchParams.set("format_turns", "true");
    const promptSummary = summarizeTranscriptionPrompt(prompt);
    if (promptSummary.promptLength > 0) url.searchParams.set("prompt", prompt.trim());
    onSessionEvent?.({
      type: "configuration",
      action: "connect",
      sampleRate,
      speechModel: env.ASSEMBLYAI_SPEECH_MODEL,
      formatTurns: true,
      ...promptSummary,
    });

    let closed = false;
    const socket = new WebSocket(url, {
      headers: {
        Authorization: env.ASSEMBLYAI_API_KEY,
      },
    } as never);

    socket.addEventListener("message", (event) => {
      void (async () => {
        const text = await readMessageText(event.data);
        let data: AssemblyAiMessage;
        try {
          data = JSON.parse(text) as AssemblyAiMessage;
        } catch (error) {
          onSessionEvent?.({
            type: "message_parse_error",
            error: error instanceof Error ? error.message : String(error),
            preview: previewText(text),
          });
          return;
        }
        onSessionEvent?.(summarizeAssemblyAiMessage(data));
        if (data.transcript) {
          const first = data.words?.[0];
          const last = data.words?.[data.words.length - 1];
          onTurn({
            text: data.transcript,
            isFinal: data.end_of_turn === true,
            ...(first?.start != null ? { startMs: first.start } : {}),
            ...(last?.end != null ? { endMs: last.end } : {}),
          });
        }
      })().catch((error) => {
        onSessionEvent?.({ type: "error", error: error instanceof Error ? error.message : String(error) });
      });
    });

    socket.addEventListener("error", () => {
      onSessionEvent?.({ type: "error", error: "AssemblyAI WebSocket error" });
    });

    socket.addEventListener("close", (event) => {
      closed = true;
      onSessionEvent?.({ type: "close", code: event.code, reason: event.reason });
    });

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => {
        onSessionEvent?.({ type: "open" });
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => reject(new Error("AssemblyAI WebSocket failed to open")), { once: true });
    });

    return {
      userId,
      sendAudio: (chunk) => {
        if (closed || socket.readyState !== WebSocket.OPEN) {
          throw new Error(`AssemblyAI WebSocket is not open for user ${userId}`);
        }
        socket.send(chunk);
      },
      close: async () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
        socket.close();
      },
    };
  },
});

import type { Env } from "../Env";
import type { StreamingTranscriptionSession, TranscriptionService } from "./TranscriptionService";

export const createAssemblyAiTranscriptionService = (env: Env): TranscriptionService => ({
  createStreamingSession: async ({ userId, sampleRate, onTurn }): Promise<StreamingTranscriptionSession> => {
    const url = new URL("wss://streaming.assemblyai.com/v3/ws");
    url.searchParams.set("sample_rate", String(sampleRate));
    url.searchParams.set("speech_model", env.ASSEMBLYAI_SPEECH_MODEL);
    url.searchParams.set("format_turns", "true");

    const socket = new WebSocket(url, {
      headers: {
        Authorization: env.ASSEMBLYAI_API_KEY,
      },
    } as never);

    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data)) as { transcript?: string; end_of_turn?: boolean; words?: Array<{ start?: number; end?: number }> };
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
    });

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("AssemblyAI WebSocket failed to open")), { once: true });
    });

    return {
      userId,
      sendAudio: (chunk) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
      },
      close: async () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
        socket.close();
      },
    };
  },
});

import type { Env } from "../Env";
import type { TtsService } from "./TtsService";

export const createElevenLabsTtsService = (env: Env): TtsService => ({
  synthesizeStream: async (text) => {
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}/stream`);
    url.searchParams.set("output_format", env.ELEVENLABS_OUTPUT_FORMAT);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL_ID,
      }),
    });
    if (!response.ok || response.body == null) {
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${await response.text().catch(() => "")}`);
    }
    return response.body;
  },
});


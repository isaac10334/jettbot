import type { Env } from "../Env";
import type { TtsService } from "./TtsService";
import { resolveElevenLabsPlaybackFormat } from "./TtsOutputFormat";

const synthesize = async (env: Env, text: string) => {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}/stream`);
  url.searchParams.set("output_format", resolveElevenLabsPlaybackFormat(env.ELEVENLABS_OUTPUT_FORMAT));
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
  return {
    body: response.body,
    status: response.status,
    ...(response.headers.get("content-type") ? { contentType: response.headers.get("content-type")! } : {}),
    ...(response.headers.get("request-id") ?? response.headers.get("x-request-id")
      ? { requestId: (response.headers.get("request-id") ?? response.headers.get("x-request-id"))! }
      : {}),
  };
};

export const createElevenLabsTtsService = (env: Env): TtsService => ({
  synthesizeStream: async (text) => (await synthesize(env, text)).body,
  synthesizeStreamWithMetadata: (text) => synthesize(env, text),
});

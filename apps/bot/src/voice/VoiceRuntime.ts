import { createRuntime } from "@loop-kit/common/Runtime";
import type { VoiceService } from "./VoiceService";

export interface VoiceRuntimeEnv {
  readonly voice: VoiceService;
}

export const createVoiceRuntime = (env: VoiceRuntimeEnv) => createRuntime(env);


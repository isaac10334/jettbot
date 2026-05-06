import { createRuntime } from "@loop-kit/common/Runtime";
import type { DiscordService } from "./DiscordService";

export interface DiscordRuntimeEnv {
  readonly discord: DiscordService;
}

export const createDiscordRuntime = (env: DiscordRuntimeEnv) => createRuntime(env);


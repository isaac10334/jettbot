import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installDiscordCommands: Installer<AppEnv> = async (runtime) => {
  await runtime.env.discord.registerSlashCommands();
  return installedVoid();
};


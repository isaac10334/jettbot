import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installDiscordGateway: Installer<AppEnv> = async (runtime) => {
  await runtime.env.discord.login();
  return installedVoid(() => runtime.env.discord.destroy());
};


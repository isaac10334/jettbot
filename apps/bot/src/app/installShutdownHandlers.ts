import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "./AppRuntime";

export const installShutdownHandlers: Installer<AppEnv> = (runtime) => {
  const shutdown = () => {
    void runtime.dispose().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return installedVoid(() => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  });
};


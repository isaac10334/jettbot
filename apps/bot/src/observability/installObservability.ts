import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installObservability: Installer<AppEnv> = (runtime) => {
  runtime.env.console.info("observability.started", {
    logFile: runtime.env.env.JETTBOT_LOG_FILE_PATH,
    sidecarLogFile: runtime.env.env.JETTBOT_SIDECAR_LOG_FILE_PATH,
    sidecarConsoleLevel: runtime.env.env.JETTBOT_SIDECAR_CONSOLE_LEVEL,
    realtimeDebugEnabled: runtime.env.env.JETTBOT_REALTIME_DEBUG_ENABLED,
    realtimeDebugDir: runtime.env.env.JETTBOT_REALTIME_DEBUG_DIR,
    metricsFile: runtime.env.env.JETTBOT_METRICS_FILE_PATH,
  });

  return installedVoid(async () => {
    runtime.env.console.info("observability.stopping");
    await runtime.env.metrics.flush();
    await runtime.env.logging.dispose();
    await runtime.env.metrics.dispose();
  });
};

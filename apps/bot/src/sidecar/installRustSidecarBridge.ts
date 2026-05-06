import { installedVoid, type Installer } from "@loop-kit/common/Runtime";
import type { AppEnv } from "../app/AppRuntime";

export const installRustSidecarBridge: Installer<AppEnv> = async (runtime) => {
  await runtime.env.sidecar.start();
  const unsubscribe = runtime.env.sidecar.events.subscribe((event) => runtime.env.signals.sidecarEvent.emit(event));
  return installedVoid(async () => {
    unsubscribe();
    await runtime.env.sidecar.stop();
  });
};


import { installedVoid, type Installer } from '@loop-kit/common/Runtime';
import type { AppEnv } from '../app/AppRuntime';

export const installMemoryEffects: Installer<AppEnv> = async (runtime) => {
    await runtime.env.memory.initialize();
    return installedVoid(() => runtime.env.memory.close());
};

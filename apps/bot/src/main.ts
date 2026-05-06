import { createAppRuntime } from './app/AppRuntime';
import { loadEnv } from './Env';

const env = loadEnv();
const app = createAppRuntime(env);

await app.start();
app.runtime.env.console.info('jettbot.started');

await new Promise<void>(() => undefined);

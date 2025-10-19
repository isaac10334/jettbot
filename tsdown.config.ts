import { esmExternalRequirePlugin } from 'rolldown/experimental'
import { defineConfig } from 'tsdown'
import Info from 'unplugin-info/rollup'
import Macros from 'unplugin-macros/rollup'
import { ViteToml } from 'vite-plugin-toml'

export default defineConfig({
  entry: 'src/index.ts',
  platform: 'node',
  outDir: 'dist',
  plugins: [Info(), Macros(), esmExternalRequirePlugin(), ViteToml()],
  sourcemap: true,
  dts: false,
  format: 'esm',
  // CRITICAL: externalize dynamic/optional deps
  external: [
    '@discordjs/voice',
    '@discordjs/opus',
    'prism-media',
    'libsodium-wrappers',
    'sodium-native',
    'ws',
    'zod',
    'ffmpeg-static',
    'discord.js',
    '@openai/agents',
    'dotenv',
  ],
})

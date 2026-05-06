import {
  analyzeVoiceSession,
  formatVoiceSessionAnalysis,
  listRealtimeSessionDirectories,
} from "../apps/bot/src/diagnostics/VoiceSessionDiagnostics";

const args = new Set(Bun.argv.slice(2));
const valueAfter = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] ?? fallback : fallback;
};

const baseDir = valueAfter("--dir", "logs/realtime");
const outputFormat = valueAfter("--elevenlabs-output-format", Bun.env.ELEVENLABS_OUTPUT_FORMAT ?? "pcm_24000");
const includeToolVersions = !args.has("--skip-tool-versions");

const sessions = await listRealtimeSessionDirectories(baseDir);
if (sessions.length === 0) {
  console.log(`No realtime sessions found under ${baseDir}`);
  process.exit(0);
}

console.log("Realtime sessions newest-first:");
for (const session of sessions) {
  console.log(`- ${session.lastWriteTimeIso} ${session.name}`);
}

const analysis = await analyzeVoiceSession(sessions[0]!, {
  elevenLabsOutputFormat: outputFormat,
  includeToolVersions,
});

console.log("");
console.log(formatVoiceSessionAnalysis(analysis));

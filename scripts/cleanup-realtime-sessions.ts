import { cleanupRealtimeSessions, createRealtimeCleanupPlan } from "../apps/bot/src/diagnostics/VoiceSessionDiagnostics";

const valueAfter = (name: string, fallback: string): string => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] ?? fallback : fallback;
};

const baseDir = valueAfter("--dir", "logs/realtime");
const keepCount = Number.parseInt(valueAfter("--keep", "3"), 10);
const dryRun = Bun.argv.includes("--dry-run");

if (!Number.isInteger(keepCount) || keepCount < 1) {
  throw new Error("--keep must be a positive integer");
}

const plan = dryRun
  ? await createRealtimeCleanupPlan(baseDir, keepCount)
  : await cleanupRealtimeSessions(baseDir, keepCount);

console.log(`Keeping ${plan.keep.length} realtime session(s):`);
for (const item of plan.keep) console.log(`- ${item.lastWriteTimeIso} ${item.name}`);

console.log(`${dryRun ? "Would remove" : "Removed"} ${plan.remove.length} realtime session(s):`);
for (const item of plan.remove) console.log(`- ${item.lastWriteTimeIso} ${item.name}`);

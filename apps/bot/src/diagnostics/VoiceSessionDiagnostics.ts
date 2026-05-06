import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { validatePcmS16leWav, validateRawPcm, type RawPcmValidationResult, type WavValidationResult } from "../audio/AudioValidationService";

export interface RealtimeSessionDirectory {
  readonly name: string;
  readonly path: string;
  readonly lastWriteTimeMs: number;
  readonly lastWriteTimeIso: string;
}

export interface VoiceSessionFileSummary {
  readonly relativePath: string;
  readonly byteLength: number;
}

export interface VoiceSessionAudioValidation {
  readonly relativePath: string;
  readonly ok: boolean;
  readonly expected?: string;
  readonly result?: WavValidationResult | RawPcmValidationResult;
  readonly error?: string;
}

export interface VoiceSessionAnalysis {
  readonly session: RealtimeSessionDirectory;
  readonly files: readonly VoiceSessionFileSummary[];
  readonly assemblyAi: {
    readonly sessionEventCount: number;
    readonly messageTypes: Record<string, number>;
    readonly closeCodes: Record<string, number>;
    readonly hasTurn: boolean;
  };
  readonly transcripts: {
    readonly count: number;
    readonly finalCount: number;
    readonly diagnosticCount: number;
    readonly userIds: readonly string[];
    readonly knownUserIds: readonly string[];
  };
  readonly playback: {
    readonly eventCount: number;
    readonly stages: Record<string, number>;
    readonly startedCount: number;
    readonly finishedCount: number;
    readonly overlappingStreamCount: number;
  };
  readonly voice: {
    readonly clientConnectMappedCount: number;
    readonly speakingStateMappedCount: number;
    readonly earlyBufferedCount: number;
    readonly mappedSsrcs: readonly number[];
    readonly unknownFallbackCount: number;
    readonly unknownResolvedCount: number;
    readonly speakingStartCount: number;
    readonly speakingStopCount: number;
    readonly decodedVoiceTickCount: number;
    readonly firstDecodedChunkCount: number;
  };
  readonly audio: readonly VoiceSessionAudioValidation[];
  readonly missingStages: readonly string[];
  readonly toolVersions: Record<string, string>;
}

export interface RealtimeCleanupPlan {
  readonly keep: readonly RealtimeSessionDirectory[];
  readonly remove: readonly RealtimeSessionDirectory[];
}

const readJsonLineValues = async (path: string): Promise<unknown[]> => {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  if (text.trim() === "") return [];
  const values: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as { readonly value?: unknown };
      values.push(parsed.value ?? parsed);
    } catch {
      values.push({ type: "json_parse_error" });
    }
  }
  return values;
};

const readJsonLineRecords = async (path: string): Promise<Array<{ readonly timestamp?: string; readonly value: unknown }>> => {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  if (text.trim() === "") return [];
  const values: Array<{ readonly timestamp?: string; readonly value: unknown }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as { readonly timestamp?: string; readonly value?: unknown };
      values.push({ ...(parsed.timestamp ? { timestamp: parsed.timestamp } : {}), value: parsed.value ?? parsed });
    } catch {
      values.push({ value: { type: "json_parse_error" } });
    }
  }
  return values;
};

const increment = (counts: Record<string, number>, key: string | number | undefined): void => {
  const text = String(key ?? "unknown");
  counts[text] = (counts[text] ?? 0) + 1;
};

const hasOwnString = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value == null) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" ? item : undefined;
};

const hasOwnBoolean = (value: unknown, key: string): boolean | undefined => {
  if (typeof value !== "object" || value == null) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "boolean" ? item : undefined;
};

const hasOwnNumber = (value: unknown, key: string): number | undefined => {
  if (typeof value !== "object" || value == null) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" ? item : undefined;
};

const hasOwnTrue = (value: unknown, key: string): boolean => {
  if (typeof value !== "object" || value == null) return false;
  return (value as Record<string, unknown>)[key] === true;
};

const readFilesRecursive = async (root: string, current = root): Promise<VoiceSessionFileSummary[]> => {
  const entries = await readdir(current, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: VoiceSessionFileSummary[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readFilesRecursive(root, path));
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(path);
    files.push({
      relativePath: relative(root, path).replaceAll("\\", "/"),
      byteLength: info.size,
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const listRealtimeSessionDirectories = async (baseDir: string): Promise<RealtimeSessionDirectory[]> => {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const directories: RealtimeSessionDirectory[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(baseDir, entry.name);
    const info = await stat(path);
    directories.push({
      name: entry.name,
      path,
      lastWriteTimeMs: info.mtimeMs,
      lastWriteTimeIso: info.mtime.toISOString(),
    });
  }
  return directories.sort((a, b) => b.lastWriteTimeMs - a.lastWriteTimeMs || b.name.localeCompare(a.name));
};

const validateAudioFile = async (sessionPath: string, relativePath: string, elevenLabsOutputFormat: string): Promise<VoiceSessionAudioValidation | undefined> => {
  const normalized = relativePath.replaceAll("\\", "/");
  const bytes = await Bun.file(join(sessionPath, normalized)).bytes();
  try {
    if (normalized.endsWith("/discord-input.wav")) {
      const result = validatePcmS16leWav(bytes);
      if (result.sampleRate !== 48_000 || result.channels !== 2) {
        throw new Error(`expected 48000Hz stereo, got ${result.sampleRate}Hz ${result.channels}ch`);
      }
      return { relativePath: normalized, ok: true, expected: "pcm_s16le wav 48000Hz stereo", result };
    }
    if (normalized.endsWith("/assemblyai-input.wav")) {
      const result = validatePcmS16leWav(bytes);
      if (result.sampleRate !== 16_000 || result.channels !== 1) {
        throw new Error(`expected 16000Hz mono, got ${result.sampleRate}Hz ${result.channels}ch`);
      }
      return { relativePath: normalized, ok: true, expected: "pcm_s16le wav 16000Hz mono", result };
    }
    if (normalized.includes("/audio/tts/") && elevenLabsOutputFormat.startsWith("pcm_")) {
      const sampleRate = Number(elevenLabsOutputFormat.slice("pcm_".length));
      const result = validateRawPcm({ bytes, sampleRate, channels: 1, bytesPerSample: 2 });
      return { relativePath: normalized, ok: true, expected: `raw pcm_s16le ${sampleRate}Hz mono`, result };
    }
    return undefined;
  } catch (error) {
    return {
      relativePath: normalized,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const firstToolLine = async (cmd: string): Promise<string> => {
  try {
    const proc = Bun.spawn({ cmd: [cmd, "-version"], stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const text = `${stdout}\n${stderr}`.trim();
    const first = text.split(/\r?\n/).find((line) => line.trim().length > 0);
    return `${cmd}: ${code === 0 ? first ?? "no output" : `exit ${code} ${first ?? ""}`}`.trim();
  } catch (error) {
    return `${cmd}: unavailable (${error instanceof Error ? error.message : String(error)})`;
  }
};

export const analyzeVoiceSession = async (
  session: RealtimeSessionDirectory,
  options: { readonly elevenLabsOutputFormat?: string; readonly includeToolVersions?: boolean } = {},
): Promise<VoiceSessionAnalysis> => {
  const files = await readFilesRecursive(session.path);
  const sessionEvents = await readJsonLineValues(join(session.path, "text", "transcription-sessions.jsonl"));
  const transcriptLines = await readJsonLineValues(join(session.path, "text", "transcripts.jsonl"));
  const voiceEventLines = await readJsonLineRecords(join(session.path, "text", "voice-events.jsonl"));
  const voiceEvents = voiceEventLines.map((line) => line.value);

  const messageTypes: Record<string, number> = {};
  const closeCodes: Record<string, number> = {};
  for (const value of sessionEvents) {
    const event = typeof value === "object" && value != null ? (value as Record<string, unknown>).event : undefined;
    if (event && typeof event === "object") {
      increment(messageTypes, hasOwnString(event, "messageType") ?? hasOwnString(event, "type"));
      const closeCode = hasOwnNumber(event, "code");
      if (closeCode != null) increment(closeCodes, closeCode);
    }
  }

  const userIds = new Set<string>();
  const knownUserIds = new Set<string>();
  let finalCount = 0;
  let diagnosticCount = 0;
  for (const value of transcriptLines) {
    const userId = hasOwnString(value, "userId");
    if (userId) {
      userIds.add(userId);
      if (!userId.startsWith("unknown_ssrc:")) knownUserIds.add(userId);
    }
    if (hasOwnBoolean(value, "isFinal") === true) finalCount += 1;
    if (hasOwnBoolean(value, "diagnosticSpeaker") === true) diagnosticCount += 1;
  }

  const playbackStages: Record<string, number> = {};
  let playbackEventCount = 0;
  let playbackStartedCount = 0;
  let playbackFinishedCount = 0;
  const playbackIntervals = new Map<string, { readonly streamId: string; readonly guildId?: string; readonly startMs: number; endMs?: number }>();
  let unknownFallbackCount = 0;
  let unknownResolvedCount = 0;
  let clientConnectMappedCount = 0;
  let speakingStateMappedCount = 0;
  let earlyBufferedCount = 0;
  const mappedSsrcs = new Set<number>();
  let speakingStartCount = 0;
  let speakingStopCount = 0;
  let decodedVoiceTickCount = 0;
  let firstDecodedChunkCount = 0;
  for (const [index, value] of voiceEvents.entries()) {
    const type = hasOwnString(value, "type");
    const stage = hasOwnString(value, "stage");
    const streamId = hasOwnString(value, "stream_id");
    const guildId = hasOwnString(value, "guild_id");
    const timestampMs = voiceEventLines[index]?.timestamp ? Date.parse(voiceEventLines[index]!.timestamp!) : undefined;
    if (type?.startsWith("Playback")) playbackEventCount += 1;
    if (type === "PlaybackDebug") increment(playbackStages, stage);
    if (type === "PlaybackStarted") playbackStartedCount += 1;
    if (type === "PlaybackFinished") playbackFinishedCount += 1;
    if (type === "PlaybackDebug" && stage === "playable" && streamId && Number.isFinite(timestampMs)) {
      playbackIntervals.set(streamId, { streamId, ...(guildId ? { guildId } : {}), startMs: timestampMs! });
    }
    if ((type === "PlaybackFinished" || (type === "PlaybackDebug" && stage === "end")) && streamId && Number.isFinite(timestampMs)) {
      const interval = playbackIntervals.get(streamId);
      if (interval) interval.endMs = timestampMs!;
    }
    if (type === "VoiceDebug" && stage === "unknown_ssrc_audio_fallback") unknownFallbackCount += 1;
    if (type === "VoiceDebug" && stage === "unknown_ssrc_resolved") unknownResolvedCount += 1;
    if (type === "VoiceDebug" && stage === "client_connect_mapped") clientConnectMappedCount += 1;
    if (type === "VoiceDebug" && stage === "speaking_state_mapped") speakingStateMappedCount += 1;
    if (type === "VoiceDebug" && stage === "decoded_voice_tick") decodedVoiceTickCount += 1;
    if (type === "VoiceDebug" && stage === "first_decoded_chunk") firstDecodedChunkCount += 1;
    if (type === "VoiceDebug" && hasOwnTrue(value, "early_buffered")) earlyBufferedCount += 1;
    if (type === "VoiceDebug" && (stage === "client_connect_mapped" || stage === "speaking_state_mapped")) {
      const ssrc = hasOwnNumber(value, "ssrc");
      if (ssrc != null) mappedSsrcs.add(ssrc);
    }
    if (type === "UserSpeakingStart") speakingStartCount += 1;
    if (type === "UserSpeakingStop") speakingStopCount += 1;
  }

  const audio = (await Promise.all(files
    .filter((file) => file.relativePath.startsWith("audio/"))
    .map((file) => validateAudioFile(session.path, file.relativePath, options.elevenLabsOutputFormat ?? "pcm_24000"))))
    .filter((value): value is VoiceSessionAudioValidation => value != null);

  const intervals = [...playbackIntervals.values()]
    .filter((interval) => interval.endMs != null)
    .sort((a, b) => a.startMs - b.startMs);
  let overlappingStreamCount = 0;
  for (let index = 0; index < intervals.length; index += 1) {
    const current = intervals[index]!;
    if (intervals.some((other, otherIndex) =>
      otherIndex !== index &&
      (other.guildId ?? "") === (current.guildId ?? "") &&
      other.startMs < current.endMs! &&
      current.startMs < other.endMs!
    )) {
      overlappingStreamCount += 1;
    }
  }

  const missingStages: string[] = [];
  if (unknownFallbackCount === 0 && speakingStartCount === 0 && decodedVoiceTickCount === 0 && firstDecodedChunkCount === 0) {
    missingStages.push("discord_receive_audio");
  }
  if (clientConnectMappedCount === 0 && speakingStateMappedCount === 0) missingStages.push("attribution_mapping_missing");
  if (!Object.keys(messageTypes).includes("Turn")) missingStages.push("assemblyai_turns");
  if (knownUserIds.size === 0) missingStages.push("known_user_transcripts");
  if (!files.some((file) => file.relativePath === "text/llm-responses.jsonl")) missingStages.push("llm_response");
  if (!files.some((file) => file.relativePath === "text/tts.jsonl")) missingStages.push("tts_stream");
  if (playbackStartedCount === 0) missingStages.push("discord_playback");

  const toolVersions = options.includeToolVersions === true
    ? {
        ffmpeg: await firstToolLine("ffmpeg"),
        ffprobe: await firstToolLine("ffprobe"),
      }
    : {};

  return {
    session,
    files,
    assemblyAi: {
      sessionEventCount: sessionEvents.length,
      messageTypes,
      closeCodes,
      hasTurn: Object.keys(messageTypes).includes("Turn"),
    },
    transcripts: {
      count: transcriptLines.length,
      finalCount,
      diagnosticCount,
      userIds: [...userIds].sort(),
      knownUserIds: [...knownUserIds].sort(),
    },
    playback: {
      eventCount: playbackEventCount,
      stages: playbackStages,
      startedCount: playbackStartedCount,
      finishedCount: playbackFinishedCount,
      overlappingStreamCount,
    },
    voice: {
      clientConnectMappedCount,
      speakingStateMappedCount,
      earlyBufferedCount,
      mappedSsrcs: [...mappedSsrcs].sort((a, b) => a - b),
      unknownFallbackCount,
      unknownResolvedCount,
      speakingStartCount,
      speakingStopCount,
      decodedVoiceTickCount,
      firstDecodedChunkCount,
    },
    audio,
    missingStages,
    toolVersions,
  };
};

export const createRealtimeCleanupPlan = async (baseDir: string, keepCount: number): Promise<RealtimeCleanupPlan> => {
  const directories = await listRealtimeSessionDirectories(baseDir);
  return {
    keep: directories.slice(0, keepCount),
    remove: directories.slice(keepCount),
  };
};

export const cleanupRealtimeSessions = async (baseDir: string, keepCount: number): Promise<RealtimeCleanupPlan> => {
  const plan = await createRealtimeCleanupPlan(baseDir, keepCount);
  const resolvedBase = await realpath(baseDir);
  for (const item of plan.remove) {
    const resolvedItem = await realpath(item.path);
    const relativePath = relative(resolvedBase, resolvedItem);
    if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(":")) {
      throw new Error(`Refusing to remove path outside realtime log dir: ${resolvedItem}`);
    }
    await rm(item.path, { recursive: true, force: true });
  }
  return plan;
};

export const formatVoiceSessionAnalysis = (analysis: VoiceSessionAnalysis): string => {
  const lines = [
    `Session: ${analysis.session.name}`,
    `Path: ${analysis.session.path}`,
    `Last write: ${analysis.session.lastWriteTimeIso}`,
    `Files: ${analysis.files.length}`,
    `AssemblyAI events: ${analysis.assemblyAi.sessionEventCount} ${JSON.stringify(analysis.assemblyAi.messageTypes)}`,
    `Transcripts: ${analysis.transcripts.count} final=${analysis.transcripts.finalCount} diagnostic=${analysis.transcripts.diagnosticCount}`,
    `Users: ${analysis.transcripts.userIds.join(", ") || "(none)"}`,
    `Known users: ${analysis.transcripts.knownUserIds.join(", ") || "(none)"}`,
    `Voice: clientConnectMapped=${analysis.voice.clientConnectMappedCount} speakingStateMapped=${analysis.voice.speakingStateMappedCount} earlyBuffered=${analysis.voice.earlyBufferedCount} mappedSsrcs=${analysis.voice.mappedSsrcs.join(",") || "(none)"} unknownFallback=${analysis.voice.unknownFallbackCount} unknownResolved=${analysis.voice.unknownResolvedCount} speakingStart=${analysis.voice.speakingStartCount} decodedTicks=${analysis.voice.decodedVoiceTickCount} firstDecodedChunks=${analysis.voice.firstDecodedChunkCount}`,
    `Playback: started=${analysis.playback.startedCount} finished=${analysis.playback.finishedCount} stages=${JSON.stringify(analysis.playback.stages)}`,
    `Playback overlap: overlappingStreams=${analysis.playback.overlappingStreamCount}`,
    `Missing stages: ${analysis.missingStages.join(", ") || "(none)"}`,
  ];
  for (const [tool, version] of Object.entries(analysis.toolVersions)) lines.push(`${tool}: ${version}`);
  for (const item of analysis.audio.filter((audio) => !audio.ok)) lines.push(`Audio validation failed: ${item.relativePath}: ${item.error}`);
  return `${lines.join("\n")}\n`;
};

export const latestRealtimeSessionName = async (baseDir: string): Promise<string | undefined> =>
  (await listRealtimeSessionDirectories(baseDir))[0]?.name;

export const sessionNameFromPath = (path: string): string => basename(path);

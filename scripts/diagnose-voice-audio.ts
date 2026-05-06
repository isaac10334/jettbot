import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createAudioNormalizationService } from "../apps/bot/src/audio/AudioNormalizationService";
import { validatePcmS16leWav, validateRawPcm } from "../apps/bot/src/audio/AudioValidationService";
import { listRealtimeSessionDirectories } from "../apps/bot/src/diagnostics/VoiceSessionDiagnostics";

const realtimeDir = "logs/realtime";
const outputDir = "logs/audio-diagnostics";

const readAscii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length));

const wavDataChunk = (bytes: Uint8Array): Uint8Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > bytes.byteLength) throw new Error(`WAV chunk ${chunkId} exceeds file size`);
    if (chunkId === "data") return bytes.slice(chunkStart, chunkEnd);
    offset = chunkEnd + (chunkSize % 2);
  }
  throw new Error("WAV data chunk missing");
};

const writeWav = async (path: string, data: Uint8Array, sampleRate: number, channels: number): Promise<void> => {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + data.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, data.byteLength, true);
  await Bun.write(path, new Blob([header, data]));
};

const main = async () => {
  const sessions = await listRealtimeSessionDirectories(realtimeDir);
  const candidates: Array<{ readonly session: string; readonly path: string; readonly byteLength: number }> = [];
  for (const session of sessions) {
    const proc = Bun.spawn({
      cmd: ["powershell", "-NoProfile", "-Command", `Get-ChildItem -LiteralPath ${JSON.stringify(join(session.path, "audio", "users"))} -Recurse -Filter discord-input.wav -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName`],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    for (const path of stdout.split(/\r?\n/).filter(Boolean)) {
      const file = Bun.file(path);
      candidates.push({ session: session.name, path, byteLength: file.size });
    }
  }
  candidates.sort((a, b) => b.byteLength - a.byteLength);
  const selected = candidates[0];
  if (!selected) throw new Error("No captured discord-input.wav files found");

  const inputBytes = await Bun.file(selected.path).bytes();
  const wav = validatePcmS16leWav(inputBytes);
  if (wav.sampleRate !== 48_000 || wav.channels !== 2) {
    throw new Error(`Expected Discord WAV 48000Hz stereo, got ${wav.sampleRate}Hz ${wav.channels}ch`);
  }
  const normalizer = createAudioNormalizationService().createAssemblyAiNormalizer();
  const normalized = normalizer.normalize(wavDataChunk(inputBytes), { sampleRate: wav.sampleRate, channels: wav.channels });
  validateRawPcm({ bytes: normalized.bytes, sampleRate: 16_000, channels: 1, bytesPerSample: 2 });
  const packetBytes = 3_200;
  const packetCount = Math.floor(normalized.bytes.byteLength / packetBytes);

  await mkdir(outputDir, { recursive: true });
  const prefix = `${Date.now()}-${basename(selected.session)}`;
  await Bun.write(join(outputDir, `${prefix}-source.txt`), `${selected.path}\n`);
  await writeWav(join(outputDir, `${prefix}-assemblyai-input.wav`), normalized.bytes, 16_000, 1);
  await Bun.write(join(outputDir, `${prefix}-summary.json`), JSON.stringify({
    sourceSession: selected.session,
    sourcePath: selected.path,
    sourceBytes: selected.byteLength,
    source: wav,
    normalizedBytes: normalized.bytes.byteLength,
    packetBytes,
    packetCount,
    trailingBytes: normalized.bytes.byteLength - packetCount * packetBytes,
  }, null, 2));
  console.log(`Selected ${selected.path}`);
  console.log(`Wrote ${join(outputDir, `${prefix}-assemblyai-input.wav`)}`);
};

await main();

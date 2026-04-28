export type AudioFormat = "pcm_s16le_16000_mono" | "pcm_s16le_48000_stereo" | "opus_48000_128" | string;

export interface CommandBase {
  readonly id?: string;
  readonly type: string;
}

export interface JoinVoiceCommand extends CommandBase {
  readonly type: "JoinVoice";
  readonly guild_id: string;
  readonly channel_id: string;
}

export interface LeaveVoiceCommand extends CommandBase {
  readonly type: "LeaveVoice";
}

export interface StartReceiveCommand extends CommandBase {
  readonly type: "StartReceive";
}

export interface StopReceiveCommand extends CommandBase {
  readonly type: "StopReceive";
}

export interface PlayAudioStreamBeginCommand extends CommandBase {
  readonly type: "PlayAudioStreamBegin";
  readonly stream_id: string;
  readonly format: AudioFormat;
}

export interface PlayAudioStreamChunkCommand extends CommandBase {
  readonly type: "PlayAudioStreamChunk";
  readonly stream_id: string;
  readonly bytes_base64: string;
}

export interface PlayAudioStreamEndCommand extends CommandBase {
  readonly type: "PlayAudioStreamEnd";
  readonly stream_id: string;
}

export interface StopPlaybackCommand extends CommandBase {
  readonly type: "StopPlayback";
}

export interface EmitFakeUserAudioCommand extends CommandBase {
  readonly type: "EmitFakeUserAudio";
  readonly user_id: string;
  readonly pcm_s16le_base64: string;
  readonly sample_rate: number;
  readonly channels: number;
}

export interface ShutdownCommand extends CommandBase {
  readonly type: "Shutdown";
}

export type SidecarCommand =
  | JoinVoiceCommand
  | LeaveVoiceCommand
  | StartReceiveCommand
  | StopReceiveCommand
  | PlayAudioStreamBeginCommand
  | PlayAudioStreamChunkCommand
  | PlayAudioStreamEndCommand
  | StopPlaybackCommand
  | EmitFakeUserAudioCommand
  | ShutdownCommand;

export interface SidecarResponse {
  readonly id: string;
  readonly type: "Response";
  readonly ok: boolean;
  readonly error?: string;
}

export interface SidecarReadyEvent {
  readonly type: "Ready";
}

export interface JoinedVoiceEvent {
  readonly type: "JoinedVoice";
  readonly guild_id: string;
  readonly channel_id: string;
  readonly session_id: string;
}

export interface LeftVoiceEvent {
  readonly type: "LeftVoice";
  readonly session_id?: string;
}

export interface UserSpeakingEvent {
  readonly type: "UserSpeakingStart" | "UserSpeakingStop";
  readonly user_id: string;
  readonly timestamp_ms: number;
}

export interface UserAudioChunkEvent {
  readonly type: "UserAudioChunk";
  readonly user_id: string;
  readonly pcm_s16le_base64: string;
  readonly sample_rate: number;
  readonly channels: number;
  readonly timestamp_ms: number;
}

export interface PlaybackEvent {
  readonly type: "PlaybackStarted" | "PlaybackFinished";
  readonly stream_id: string;
}

export interface SidecarErrorEvent {
  readonly type: "Error";
  readonly code: string;
  readonly message: string;
  readonly request_id?: string;
}

export type SidecarEvent =
  | SidecarReadyEvent
  | JoinedVoiceEvent
  | LeftVoiceEvent
  | UserSpeakingEvent
  | UserAudioChunkEvent
  | PlaybackEvent
  | SidecarErrorEvent;

export type SidecarMessage = SidecarResponse | SidecarEvent;

export const isSidecarResponse = (message: SidecarMessage): message is SidecarResponse =>
  message.type === "Response";

export const isSidecarEvent = (message: SidecarMessage): message is SidecarEvent => message.type !== "Response";

export const validateSidecarMessage = (value: unknown): SidecarMessage => {
  if (typeof value !== "object" || value == null || !("type" in value)) {
    throw new Error("Sidecar message must be an object with type");
  }
  return value as SidecarMessage;
};


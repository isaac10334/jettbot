use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum SidecarCommand {
    JoinVoice {
        id: Option<String>,
        guild_id: String,
        channel_id: String,
    },
    LeaveVoice {
        id: Option<String>,
        guild_id: String,
    },
    StartReceive {
        id: Option<String>,
        guild_id: String,
    },
    StopReceive {
        id: Option<String>,
        guild_id: String,
    },
    PlayAudioStreamBegin {
        id: Option<String>,
        guild_id: String,
        stream_id: String,
        format: String,
    },
    PlayAudioStreamChunk {
        id: Option<String>,
        stream_id: String,
        bytes_base64: String,
    },
    PlayAudioStreamEnd {
        id: Option<String>,
        stream_id: String,
    },
    PlayAudioFile {
        id: Option<String>,
        guild_id: String,
        stream_id: String,
        path: String,
        format: String,
    },
    StopPlayback {
        id: Option<String>,
        guild_id: String,
    },
    EmitFakeUserAudio {
        id: Option<String>,
        user_id: String,
        pcm_s16le_base64: String,
        sample_rate: u32,
        channels: u8,
    },
    Shutdown {
        id: Option<String>,
    },
}

impl SidecarCommand {
    pub fn id(&self) -> Option<&str> {
        match self {
            Self::JoinVoice { id, .. }
            | Self::LeaveVoice { id, .. }
            | Self::StartReceive { id, .. }
            | Self::StopReceive { id, .. }
            | Self::PlayAudioStreamBegin { id, .. }
            | Self::PlayAudioStreamChunk { id, .. }
            | Self::PlayAudioStreamEnd { id, .. }
            | Self::PlayAudioFile { id, .. }
            | Self::StopPlayback { id, .. }
            | Self::EmitFakeUserAudio { id, .. }
            | Self::Shutdown { id } => id.as_deref(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum SidecarEvent {
    Ready,
    JoinedVoice {
        guild_id: String,
        channel_id: String,
        session_id: String,
    },
    LeftVoice {
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        session_id: Option<String>,
    },
    UserSpeakingStart {
        guild_id: String,
        channel_id: String,
        session_id: String,
        user_id: String,
        timestamp_ms: u64,
    },
    UserSpeakingStop {
        guild_id: String,
        channel_id: String,
        session_id: String,
        user_id: String,
        timestamp_ms: u64,
    },
    UserAudioChunk {
        guild_id: String,
        channel_id: String,
        session_id: String,
        user_id: String,
        pcm_s16le_base64: String,
        sample_rate: u32,
        channels: u8,
        timestamp_ms: u64,
    },
    PlaybackStarted {
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        stream_id: String,
    },
    PlaybackChunk {
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        stream_id: String,
        chunk_count: u64,
        byte_count: u64,
    },
    PlaybackDebug {
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        stream_id: String,
        stage: String,
        message: String,
        byte_count: Option<u64>,
        position_ms: Option<u64>,
    },
    VoiceDebug {
        stage: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        channel_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        user_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ssrc: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        byte_count: Option<u64>,
    },
    PlaybackFinished {
        #[serde(skip_serializing_if = "Option::is_none")]
        guild_id: Option<String>,
        stream_id: String,
        chunk_count: u64,
        byte_count: u64,
    },
    Error {
        code: String,
        message: String,
        request_id: Option<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum SidecarOutput {
    Response {
        id: String,
        ok: bool,
        error: Option<String>,
    },
    #[serde(untagged)]
    Event(SidecarEvent),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_round_trips() {
        let text = r#"{"type":"JoinVoice","id":"1","guild_id":"2","channel_id":"3"}"#;
        let command: SidecarCommand = serde_json::from_str(text).unwrap();
        assert_eq!(command.id(), Some("1"));
    }

    #[test]
    fn event_has_type_tag() {
        let event = SidecarEvent::Ready;
        let text = serde_json::to_string(&event).unwrap();
        assert_eq!(text, r#"{"type":"Ready"}"#);
    }

    #[test]
    fn voice_debug_skips_empty_optional_fields() {
        let event = SidecarEvent::VoiceDebug {
            stage: "receive_enabled".into(),
            message: "enabled".into(),
            guild_id: None,
            channel_id: None,
            session_id: None,
            user_id: None,
            ssrc: None,
            byte_count: None,
        };
        let text = serde_json::to_string(&event).unwrap();
        assert_eq!(
            text,
            r#"{"type":"VoiceDebug","stage":"receive_enabled","message":"enabled"}"#
        );
    }
}

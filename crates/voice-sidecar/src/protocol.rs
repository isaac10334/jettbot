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
    },
    StartReceive {
        id: Option<String>,
    },
    StopReceive {
        id: Option<String>,
    },
    PlayAudioStreamBegin {
        id: Option<String>,
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
    StopPlayback {
        id: Option<String>,
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
            | Self::LeaveVoice { id }
            | Self::StartReceive { id }
            | Self::StopReceive { id }
            | Self::PlayAudioStreamBegin { id, .. }
            | Self::PlayAudioStreamChunk { id, .. }
            | Self::PlayAudioStreamEnd { id, .. }
            | Self::StopPlayback { id }
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
        session_id: Option<String>,
    },
    UserSpeakingStart {
        user_id: String,
        timestamp_ms: u64,
    },
    UserSpeakingStop {
        user_id: String,
        timestamp_ms: u64,
    },
    UserAudioChunk {
        user_id: String,
        pcm_s16le_base64: String,
        sample_rate: u32,
        channels: u8,
        timestamp_ms: u64,
    },
    PlaybackStarted {
        stream_id: String,
    },
    PlaybackFinished {
        stream_id: String,
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
}

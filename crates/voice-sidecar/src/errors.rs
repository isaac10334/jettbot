use thiserror::Error;

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("missing DISCORD_BOT_TOKEN")]
    MissingToken,
    #[error("discord context is not ready")]
    DiscordNotReady,
    #[error("already joined voice session {0}")]
    AlreadyJoined(String),
    #[error("not joined to voice")]
    NotJoined,
    #[error("invalid id: {0}")]
    InvalidId(String),
    #[error("invalid audio format: {0}")]
    InvalidAudioFormat(String),
    #[error("serenity error: {0}")]
    Serenity(#[from] serenity::Error),
    #[error("songbird join failed")]
    SongbirdJoin,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SidecarError>;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use dashmap::DashMap;
use serenity::{
    async_trait,
    client::Context,
    model::id::{ChannelId, GuildId},
};
use songbird::{
    driver::{DecodeConfig, DecodeMode},
    model::{
        id::UserId,
        payload::{ClientDisconnect, Speaking},
    },
    Config, CoreEvent, Event, EventContext, EventHandler as VoiceEventHandler,
};
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::{
    audio::i16_samples_to_le_bytes,
    errors::{Result, SidecarError},
    protocol::SidecarEvent,
    sessions::{SessionState, VoiceSession},
};

pub fn songbird_config() -> Config {
    Config::default().decode_mode(DecodeMode::Decode(DecodeConfig::default()))
}

#[derive(Clone)]
struct Receiver {
    inner: Arc<InnerReceiver>,
}

struct InnerReceiver {
    guild_id: String,
    channel_id: String,
    session_id: String,
    enabled: Arc<AtomicBool>,
    last_tick_was_empty: AtomicBool,
    first_speaking_logged: AtomicBool,
    first_voice_tick_logged: AtomicBool,
    first_unknown_ssrc_logged: AtomicBool,
    first_decoded_chunk_logged: AtomicBool,
    known_ssrcs: DashMap<u32, UserId>,
    events: UnboundedSender<SidecarEvent>,
}

impl Receiver {
    fn new(events: UnboundedSender<SidecarEvent>, session: &VoiceSession) -> Self {
        Self {
            inner: Arc::new(InnerReceiver {
                guild_id: session.guild_id.clone(),
                channel_id: session.channel_id.clone(),
                session_id: session.session_id.clone(),
                enabled: session.receive_enabled(),
                last_tick_was_empty: AtomicBool::default(),
                first_speaking_logged: AtomicBool::default(),
                first_voice_tick_logged: AtomicBool::default(),
                first_unknown_ssrc_logged: AtomicBool::default(),
                first_decoded_chunk_logged: AtomicBool::default(),
                known_ssrcs: DashMap::new(),
                events,
            }),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn emit_voice_debug(
    events: &UnboundedSender<SidecarEvent>,
    stage: &str,
    message: String,
    guild_id: Option<String>,
    channel_id: Option<String>,
    session_id: Option<String>,
    user_id: Option<String>,
    byte_count: Option<u64>,
) {
    let _ = events.send(SidecarEvent::VoiceDebug {
        stage: stage.into(),
        message,
        guild_id,
        channel_id,
        session_id,
        user_id,
        byte_count,
    });
}

#[async_trait]
impl VoiceEventHandler for Receiver {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        if !self.inner.enabled.load(Ordering::SeqCst) {
            return None;
        }
        match ctx {
            EventContext::SpeakingStateUpdate(Speaking {
                speaking,
                ssrc,
                user_id,
                ..
            }) => {
                if let Some(user) = user_id {
                    if !self
                        .inner
                        .first_speaking_logged
                        .swap(true, Ordering::SeqCst)
                    {
                        emit_voice_debug(
                            &self.inner.events,
                            "first_speaking_event",
                            format!("ssrc={ssrc} speaking_bits={}", speaking.bits()),
                            None,
                            None,
                            None,
                            Some(user.0.to_string()),
                            None,
                        );
                    }
                    self.inner.known_ssrcs.insert(*ssrc, *user);
                    let event = if speaking.bits() == 0 {
                        SidecarEvent::UserSpeakingStop {
                            guild_id: self.inner.guild_id.clone(),
                            channel_id: self.inner.channel_id.clone(),
                            session_id: self.inner.session_id.clone(),
                            user_id: user.0.to_string(),
                            timestamp_ms: now_ms(),
                        }
                    } else {
                        SidecarEvent::UserSpeakingStart {
                            guild_id: self.inner.guild_id.clone(),
                            channel_id: self.inner.channel_id.clone(),
                            session_id: self.inner.session_id.clone(),
                            user_id: user.0.to_string(),
                            timestamp_ms: now_ms(),
                        }
                    };
                    let _ = self.inner.events.send(event);
                }
            }
            EventContext::VoiceTick(tick) => {
                if !self
                    .inner
                    .first_voice_tick_logged
                    .swap(true, Ordering::SeqCst)
                {
                    emit_voice_debug(
                        &self.inner.events,
                        "first_voice_tick",
                        format!("speaking_count={}", tick.speaking.len()),
                        None,
                        None,
                        None,
                        None,
                        None,
                    );
                }
                let speaking = tick.speaking.len();
                let last_empty = self.inner.last_tick_was_empty.load(Ordering::SeqCst);
                if speaking == 0 {
                    if !last_empty {
                        self.inner.last_tick_was_empty.store(true, Ordering::SeqCst);
                    }
                    return None;
                }
                self.inner
                    .last_tick_was_empty
                    .store(false, Ordering::SeqCst);
                for (ssrc, data) in &tick.speaking {
                    let Some(user) = self.inner.known_ssrcs.get(ssrc) else {
                        if !self
                            .inner
                            .first_unknown_ssrc_logged
                            .swap(true, Ordering::SeqCst)
                        {
                            emit_voice_debug(
                                &self.inner.events,
                                "unknown_ssrc",
                                format!("ssrc={ssrc}"),
                                None,
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                        continue;
                    };
                    let Some(decoded_voice) = data.decoded_voice.as_ref() else {
                        continue;
                    };
                    let bytes = i16_samples_to_le_bytes(decoded_voice);
                    if !self
                        .inner
                        .first_decoded_chunk_logged
                        .swap(true, Ordering::SeqCst)
                    {
                        emit_voice_debug(
                            &self.inner.events,
                            "first_decoded_chunk",
                            format!("samples={}", decoded_voice.len()),
                            None,
                            None,
                            None,
                            Some(user.0.to_string()),
                            Some(bytes.len() as u64),
                        );
                    }
                    let _ = self.inner.events.send(SidecarEvent::UserAudioChunk {
                        guild_id: self.inner.guild_id.clone(),
                        channel_id: self.inner.channel_id.clone(),
                        session_id: self.inner.session_id.clone(),
                        user_id: user.0.to_string(),
                        pcm_s16le_base64: STANDARD.encode(bytes),
                        sample_rate: 48_000,
                        channels: 2,
                        timestamp_ms: now_ms(),
                    });
                }
            }
            EventContext::ClientDisconnect(ClientDisconnect { user_id, .. }) => {
                let _ = self.inner.events.send(SidecarEvent::UserSpeakingStop {
                    guild_id: self.inner.guild_id.clone(),
                    channel_id: self.inner.channel_id.clone(),
                    session_id: self.inner.session_id.clone(),
                    user_id: user_id.0.to_string(),
                    timestamp_ms: now_ms(),
                });
            }
            _ => {}
        }
        None
    }
}

pub async fn join_voice(
    context: &Context,
    state: &mut SessionState,
    events: UnboundedSender<SidecarEvent>,
    guild_id: &str,
    channel_id: &str,
) -> Result<VoiceSession> {
    if let Some(current) = state.get(guild_id) {
        return Err(SidecarError::AlreadyJoined(current.session_id.clone()));
    }
    emit_voice_debug(
        &events,
        "join_requested",
        "join voice command received".into(),
        Some(guild_id.to_string()),
        Some(channel_id.to_string()),
        None,
        None,
        None,
    );

    let guild = GuildId::new(
        guild_id
            .parse()
            .map_err(|_| SidecarError::InvalidId(guild_id.to_string()))?,
    );
    let channel = ChannelId::new(
        channel_id
            .parse()
            .map_err(|_| SidecarError::InvalidId(channel_id.to_string()))?,
    );
    let manager = songbird::get(context)
        .await
        .ok_or(SidecarError::DiscordNotReady)?
        .clone();

    {
        let handler_lock = manager.get_or_insert(guild);
        emit_voice_debug(
            &events,
            "songbird_handler_acquired",
            "songbird handler acquired for guild".into(),
            Some(guild_id.to_string()),
            Some(channel_id.to_string()),
            None,
            None,
            None,
        );
        let session = VoiceSession::new(
            guild_id.to_string(),
            channel_id.to_string(),
            Uuid::new_v4().to_string(),
        );
        let mut handler = handler_lock.lock().await;
        let receiver = Receiver::new(events.clone(), &session);
        handler.add_global_event(CoreEvent::SpeakingStateUpdate.into(), receiver.clone());
        handler.add_global_event(CoreEvent::VoiceTick.into(), receiver.clone());
        handler.add_global_event(CoreEvent::ClientDisconnect.into(), receiver);
        emit_voice_debug(
            &events,
            "receive_events_installed",
            "speaking, voice tick, and disconnect events installed".into(),
            Some(guild_id.to_string()),
            Some(channel_id.to_string()),
            Some(session.session_id.clone()),
            None,
            None,
        );
        drop(handler);

        let join_result = manager.join(guild, channel).await;
        if join_result.is_err() {
            emit_voice_debug(
                &events,
                "join_failed",
                "songbird join returned an error".into(),
                Some(guild_id.to_string()),
                Some(channel_id.to_string()),
                Some(session.session_id.clone()),
                None,
                None,
            );
            let _ = manager.remove(guild).await;
            return Err(SidecarError::SongbirdJoin);
        }

        emit_voice_debug(
            &events,
            "join_succeeded",
            "songbird join completed".into(),
            Some(guild_id.to_string()),
            Some(channel_id.to_string()),
            Some(session.session_id.clone()),
            None,
            None,
        );
        state.set(session.clone());
        return Ok(session);
    }
}

pub async fn leave_voice(
    context: &Context,
    state: &mut SessionState,
    guild_id: &str,
) -> Result<Option<VoiceSession>> {
    let Some(session) = state.take(guild_id) else {
        return Ok(None);
    };
    let guild = GuildId::new(
        session
            .guild_id
            .parse()
            .map_err(|_| SidecarError::InvalidId(session.guild_id.clone()))?,
    );
    let manager = songbird::get(context)
        .await
        .ok_or(SidecarError::DiscordNotReady)?
        .clone();
    manager
        .remove(guild)
        .await
        .map_err(|_| SidecarError::SongbirdJoin)?;
    Ok(Some(session))
}

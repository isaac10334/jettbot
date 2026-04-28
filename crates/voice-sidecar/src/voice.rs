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
    last_tick_was_empty: AtomicBool,
    known_ssrcs: DashMap<u32, UserId>,
    events: UnboundedSender<SidecarEvent>,
}

impl Receiver {
    fn new(events: UnboundedSender<SidecarEvent>) -> Self {
        Self {
            inner: Arc::new(InnerReceiver {
                last_tick_was_empty: AtomicBool::default(),
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

#[async_trait]
impl VoiceEventHandler for Receiver {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        match ctx {
            EventContext::SpeakingStateUpdate(Speaking {
                speaking,
                ssrc,
                user_id,
                ..
            }) => {
                if let Some(user) = user_id {
                    self.inner.known_ssrcs.insert(*ssrc, *user);
                    let event = if speaking.bits() == 0 {
                        SidecarEvent::UserSpeakingStop {
                            user_id: user.0.to_string(),
                            timestamp_ms: now_ms(),
                        }
                    } else {
                        SidecarEvent::UserSpeakingStart {
                            user_id: user.0.to_string(),
                            timestamp_ms: now_ms(),
                        }
                    };
                    let _ = self.inner.events.send(event);
                }
            }
            EventContext::VoiceTick(tick) => {
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
                        continue;
                    };
                    let Some(decoded_voice) = data.decoded_voice.as_ref() else {
                        continue;
                    };
                    let bytes = i16_samples_to_le_bytes(decoded_voice);
                    let _ = self.inner.events.send(SidecarEvent::UserAudioChunk {
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
    if let Some(current) = state.current() {
        return Err(SidecarError::AlreadyJoined(current.session_id.clone()));
    }

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
        let mut handler = handler_lock.lock().await;
        let receiver = Receiver::new(events.clone());
        handler.add_global_event(CoreEvent::SpeakingStateUpdate.into(), receiver.clone());
        handler.add_global_event(CoreEvent::VoiceTick.into(), receiver.clone());
        handler.add_global_event(CoreEvent::ClientDisconnect.into(), receiver);
    }

    let join_result = manager.join(guild, channel).await;
    if join_result.is_err() {
        let _ = manager.remove(guild).await;
        return Err(SidecarError::SongbirdJoin);
    }

    let session = VoiceSession {
        guild_id: guild_id.to_string(),
        channel_id: channel_id.to_string(),
        session_id: Uuid::new_v4().to_string(),
    };
    state.set(session.clone());
    Ok(session)
}

pub async fn leave_voice(
    context: &Context,
    state: &mut SessionState,
) -> Result<Option<VoiceSession>> {
    let Some(session) = state.take() else {
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

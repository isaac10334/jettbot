use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
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
        payload::{ClientConnect, ClientDisconnect, Speaking},
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
    logged_speaking_ssrcs: Mutex<HashSet<u32>>,
    decoded_tick_counts: Mutex<HashMap<u32, u64>>,
    known_ssrcs: DashMap<u32, UserId>,
    unknown_audio: Mutex<HashMap<u32, VecDeque<Vec<i16>>>>,
    unknown_audio_fallbacks: Mutex<HashSet<u32>>,
    events: UnboundedSender<SidecarEvent>,
}

const MAX_UNKNOWN_AUDIO_CHUNKS_PER_SSRC: usize = 250;
const FALLBACK_UNKNOWN_AUDIO_CHUNKS_PER_SSRC: usize = 10;

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
                logged_speaking_ssrcs: Mutex::new(HashSet::new()),
                decoded_tick_counts: Mutex::new(HashMap::new()),
                known_ssrcs: DashMap::new(),
                unknown_audio: Mutex::new(HashMap::new()),
                unknown_audio_fallbacks: Mutex::new(HashSet::new()),
                events,
            }),
        }
    }

    fn emit_audio_chunk(&self, user: UserId, decoded_voice: &[i16]) {
        self.emit_audio_chunk_for_user_id(user.0.to_string(), decoded_voice);
    }

    fn emit_audio_chunk_for_user_id(&self, user_id: String, decoded_voice: &[i16]) {
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
                Some(user_id.clone()),
                None,
                Some(bytes.len() as u64),
            );
        }
        let _ = self.inner.events.send(SidecarEvent::UserAudioChunk {
            guild_id: self.inner.guild_id.clone(),
            channel_id: self.inner.channel_id.clone(),
            session_id: self.inner.session_id.clone(),
            user_id,
            pcm_s16le_base64: STANDARD.encode(bytes),
            sample_rate: 48_000,
            channels: 2,
            timestamp_ms: now_ms(),
        });
    }

    fn buffer_unknown_audio(&self, ssrc: u32, decoded_voice: &[i16]) {
        let mut unknown_audio = self
            .inner
            .unknown_audio
            .lock()
            .expect("unknown audio buffer poisoned");
        let chunks = unknown_audio.entry(ssrc).or_default();
        if chunks.len() >= MAX_UNKNOWN_AUDIO_CHUNKS_PER_SSRC {
            chunks.pop_front();
        }
        chunks.push_back(decoded_voice.to_vec());
    }

    fn unknown_fallback_is_active(&self, ssrc: u32) -> bool {
        self.inner
            .unknown_audio_fallbacks
            .lock()
            .expect("unknown audio fallback set poisoned")
            .contains(&ssrc)
    }

    fn maybe_emit_unknown_audio_fallback(&self, ssrc: u32) {
        let buffered = {
            let mut unknown_audio = self
                .inner
                .unknown_audio
                .lock()
                .expect("unknown audio buffer poisoned");
            let Some(chunks) = unknown_audio.get_mut(&ssrc) else {
                return;
            };
            if chunks.len() < FALLBACK_UNKNOWN_AUDIO_CHUNKS_PER_SSRC {
                return;
            }
            chunks.drain(..).collect::<Vec<_>>()
        };

        self.inner
            .unknown_audio_fallbacks
            .lock()
            .expect("unknown audio fallback set poisoned")
            .insert(ssrc);
        let user_id = format!("unknown_ssrc:{ssrc}");
        emit_voice_debug(
            &self.inner.events,
            "unknown_ssrc_audio_fallback",
            format!("ssrc={ssrc} buffered_chunks={}", buffered.len()),
            None,
            None,
            None,
            Some(user_id.clone()),
            Some(ssrc),
            None,
        );
        for chunk in buffered {
            self.emit_audio_chunk_for_user_id(user_id.clone(), &chunk);
        }
    }

    fn maybe_emit_decoded_tick_stats(&self, ssrc: u32, decoded_voice: &[i16]) {
        let count = {
            let mut counts = self
                .inner
                .decoded_tick_counts
                .lock()
                .expect("decoded tick counts poisoned");
            let count = counts.entry(ssrc).or_insert(0);
            *count += 1;
            *count
        };
        if count == 1 || count == 10 || count == 100 || count % 1_000 == 0 {
            emit_voice_debug(
                &self.inner.events,
                "decoded_voice_tick",
                format!(
                    "ssrc={ssrc} decoded_ticks={count} samples={}",
                    decoded_voice.len()
                ),
                None,
                None,
                None,
                None,
                Some(ssrc),
                Some((decoded_voice.len() * 2) as u64),
            );
        }
    }

    fn observe_ssrc_mapping(
        &self,
        ssrc: u32,
        user: UserId,
        stage: &str,
        speaking_bits: Option<u8>,
    ) {
        self.inner.known_ssrcs.insert(ssrc, user);
        emit_voice_debug(
            &self.inner.events,
            stage,
            match speaking_bits {
                Some(bits) => format!("ssrc={ssrc} speaking_bits={bits}"),
                None => format!("ssrc={ssrc}"),
            },
            Some(self.inner.guild_id.clone()),
            Some(self.inner.channel_id.clone()),
            Some(self.inner.session_id.clone()),
            Some(user.0.to_string()),
            Some(ssrc),
            None,
        );
        self.flush_unknown_audio(ssrc, user);
    }

    fn flush_unknown_audio(&self, ssrc: u32, user: UserId) {
        let buffered = {
            let mut unknown_audio = self
                .inner
                .unknown_audio
                .lock()
                .expect("unknown audio buffer poisoned");
            unknown_audio.remove(&ssrc)
        };
        self.inner
            .unknown_audio_fallbacks
            .lock()
            .expect("unknown audio fallback set poisoned")
            .remove(&ssrc);
        let Some(chunks) = buffered else {
            return;
        };
        let chunk_count = chunks.len();
        if chunk_count > 0 {
            emit_voice_debug(
                &self.inner.events,
                "unknown_ssrc_resolved",
                format!("ssrc={ssrc} buffered_chunks={chunk_count}"),
                None,
                None,
                None,
                Some(user.0.to_string()),
                Some(ssrc),
                None,
            );
        }
        for chunk in chunks {
            self.emit_audio_chunk(user, &chunk);
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
    ssrc: Option<u32>,
    byte_count: Option<u64>,
) {
    let _ = events.send(SidecarEvent::VoiceDebug {
        stage: stage.into(),
        message,
        guild_id,
        channel_id,
        session_id,
        user_id,
        ssrc,
        byte_count,
    });
}

#[async_trait]
impl VoiceEventHandler for Receiver {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        match ctx {
            EventContext::ClientConnect(ClientConnect {
                audio_ssrc,
                user_id,
                ..
            }) => {
                self.observe_ssrc_mapping(*audio_ssrc, *user_id, "client_connect_mapped", None);
            }
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
                            Some(*ssrc),
                            None,
                        );
                    }
                    let should_log_ssrc = self
                        .inner
                        .logged_speaking_ssrcs
                        .lock()
                        .expect("logged speaking ssrc set poisoned")
                        .insert(*ssrc);
                    if should_log_ssrc {
                        emit_voice_debug(
                            &self.inner.events,
                            "speaking_state_ssrc_mapped",
                            format!("ssrc={ssrc} speaking_bits={}", speaking.bits()),
                            None,
                            None,
                            None,
                            Some(user.0.to_string()),
                            Some(*ssrc),
                            None,
                        );
                    }
                    self.observe_ssrc_mapping(
                        *ssrc,
                        *user,
                        "speaking_state_mapped",
                        Some(speaking.bits()),
                    );
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
                if !self.inner.enabled.load(Ordering::SeqCst) {
                    return None;
                }
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
                        if let Some(decoded_voice) = data.decoded_voice.as_ref() {
                            self.maybe_emit_decoded_tick_stats(*ssrc, decoded_voice);
                            if self.unknown_fallback_is_active(*ssrc) {
                                self.emit_audio_chunk_for_user_id(
                                    format!("unknown_ssrc:{ssrc}"),
                                    decoded_voice,
                                );
                            } else {
                                self.buffer_unknown_audio(*ssrc, decoded_voice);
                                self.maybe_emit_unknown_audio_fallback(*ssrc);
                            }
                        }
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
                                Some(*ssrc),
                                None,
                            );
                        }
                        continue;
                    };
                    let Some(decoded_voice) = data.decoded_voice.as_ref() else {
                        continue;
                    };
                    self.maybe_emit_decoded_tick_stats(*ssrc, decoded_voice);
                    self.emit_audio_chunk(*user, decoded_voice);
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
        handler.add_global_event(CoreEvent::ClientConnect.into(), receiver.clone());
        handler.add_global_event(CoreEvent::VoiceTick.into(), receiver.clone());
        handler.add_global_event(CoreEvent::ClientDisconnect.into(), receiver);
        emit_voice_debug(
            &events,
            "receive_events_installed",
            "client connect, speaking, voice tick, and disconnect events installed".into(),
            Some(guild_id.to_string()),
            Some(channel_id.to_string()),
            Some(session.session_id.clone()),
            None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use songbird::{
        events::context_data::{VoiceData, VoiceTick},
        model::SpeakingState,
    };
    use std::collections::{HashMap, HashSet};
    use tokio::sync::mpsc::unbounded_channel;

    fn receiver_with_receive_enabled(
        enabled: bool,
    ) -> (Receiver, tokio::sync::mpsc::UnboundedReceiver<SidecarEvent>) {
        let (sender, events) = unbounded_channel();
        let session = VoiceSession::new("guild".into(), "channel".into(), "session".into());
        session.set_receive_enabled(enabled);
        (Receiver::new(sender, &session), events)
    }

    fn receiver() -> (Receiver, tokio::sync::mpsc::UnboundedReceiver<SidecarEvent>) {
        receiver_with_receive_enabled(true)
    }

    fn voice_tick(ssrc: u32) -> VoiceTick {
        let mut speaking = HashMap::new();
        speaking.insert(ssrc, VoiceData::new(None, Some(vec![0_i16; 1920])));
        VoiceTick::new(speaking, HashSet::new())
    }

    #[tokio::test]
    async fn client_connect_maps_audio_ssrc_to_user() {
        let (receiver, mut events) = receiver();
        let user = UserId(123);

        receiver
            .act(&EventContext::ClientConnect(ClientConnect {
                audio_ssrc: 42,
                user_id: user,
                video_ssrc: 0,
            }))
            .await;

        assert_eq!(*receiver.inner.known_ssrcs.get(&42).unwrap(), user);
        let event = events.recv().await.unwrap();
        match event {
            SidecarEvent::VoiceDebug {
                stage,
                user_id,
                ssrc,
                ..
            } => {
                assert_eq!(stage, "client_connect_mapped");
                assert_eq!(user_id.as_deref(), Some("123"));
                assert_eq!(ssrc, Some(42));
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[tokio::test]
    async fn client_connect_maps_audio_ssrc_while_receive_is_disabled() {
        let (receiver, mut events) = receiver_with_receive_enabled(false);
        let user = UserId(321);

        receiver
            .act(&EventContext::ClientConnect(ClientConnect {
                audio_ssrc: 52,
                user_id: user,
                video_ssrc: 0,
            }))
            .await;

        assert_eq!(*receiver.inner.known_ssrcs.get(&52).unwrap(), user);
        assert!(matches!(
            events.recv().await.unwrap(),
            SidecarEvent::VoiceDebug { stage, ssrc: Some(52), .. } if stage == "client_connect_mapped"
        ));
    }

    #[tokio::test]
    async fn speaking_state_maps_audio_ssrc_to_user() {
        let (receiver, mut events) = receiver();
        let user = UserId(456);

        receiver
            .act(&EventContext::SpeakingStateUpdate(Speaking {
                delay: None,
                speaking: SpeakingState::MICROPHONE,
                ssrc: 77,
                user_id: Some(user),
            }))
            .await;

        assert_eq!(*receiver.inner.known_ssrcs.get(&77).unwrap(), user);
        let mut stages = Vec::new();
        while let Ok(event) = events.try_recv() {
            stages.push(event);
        }
        assert!(stages.iter().any(|event| matches!(
            event,
            SidecarEvent::VoiceDebug { stage, ssrc: Some(77), .. } if stage == "speaking_state_mapped"
        )));
        assert!(stages.iter().any(|event| matches!(
            event,
            SidecarEvent::UserSpeakingStart { user_id, .. } if user_id == "456"
        )));
    }

    #[tokio::test]
    async fn speaking_state_maps_audio_ssrc_while_receive_is_disabled() {
        let (receiver, mut events) = receiver_with_receive_enabled(false);
        let user = UserId(654);

        receiver
            .act(&EventContext::SpeakingStateUpdate(Speaking {
                delay: None,
                speaking: SpeakingState::MICROPHONE,
                ssrc: 87,
                user_id: Some(user),
            }))
            .await;

        assert_eq!(*receiver.inner.known_ssrcs.get(&87).unwrap(), user);
        let mut stages = Vec::new();
        while let Ok(event) = events.try_recv() {
            stages.push(event);
        }
        assert!(stages.iter().any(|event| matches!(
            event,
            SidecarEvent::VoiceDebug { stage, ssrc: Some(87), .. } if stage == "speaking_state_mapped"
        )));
    }

    #[tokio::test]
    async fn voice_tick_does_not_emit_audio_while_receive_is_disabled() {
        let (receiver, mut events) = receiver_with_receive_enabled(false);
        receiver.observe_ssrc_mapping(88, UserId(111), "client_connect_mapped", None);
        while events.try_recv().is_ok() {}

        receiver.act(&EventContext::VoiceTick(voice_tick(88))).await;

        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn mapping_observed_while_disabled_allows_known_audio_after_enable() {
        let (receiver, mut events) = receiver_with_receive_enabled(false);
        receiver
            .act(&EventContext::ClientConnect(ClientConnect {
                audio_ssrc: 89,
                user_id: UserId(222),
                video_ssrc: 0,
            }))
            .await;
        while events.try_recv().is_ok() {}
        receiver.inner.enabled.store(true, Ordering::SeqCst);

        receiver.act(&EventContext::VoiceTick(voice_tick(89))).await;

        let mut saw_known_audio = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, SidecarEvent::UserAudioChunk { user_id, .. } if user_id == "222") {
                saw_known_audio = true;
            }
        }
        assert!(saw_known_audio);
    }

    #[test]
    fn observing_mapping_flushes_unknown_audio_and_clears_fallback() {
        let (receiver, mut events) = receiver();
        receiver.buffer_unknown_audio(99, &[0, 1, 2, 3]);
        receiver
            .inner
            .unknown_audio_fallbacks
            .lock()
            .unwrap()
            .insert(99);

        receiver.observe_ssrc_mapping(99, UserId(789), "client_connect_mapped", None);

        assert!(!receiver
            .inner
            .unknown_audio
            .lock()
            .unwrap()
            .contains_key(&99));
        assert!(!receiver
            .inner
            .unknown_audio_fallbacks
            .lock()
            .unwrap()
            .contains(&99));
        let mut saw_resolved = false;
        let mut saw_audio = false;
        while let Ok(event) = events.try_recv() {
            match event {
                SidecarEvent::VoiceDebug { stage, .. } if stage == "unknown_ssrc_resolved" => {
                    saw_resolved = true;
                }
                SidecarEvent::UserAudioChunk { user_id, .. } if user_id == "789" => {
                    saw_audio = true;
                }
                _ => {}
            }
        }
        assert!(saw_resolved);
        assert!(saw_audio);
    }
}

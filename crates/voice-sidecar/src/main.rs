mod audio;
mod discord;
mod errors;
mod playback;
mod protocol;
mod sessions;
mod voice;

use std::env;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use errors::{Result, SidecarError};
use playback::PlaybackState;
use protocol::{SidecarCommand, SidecarEvent, SidecarOutput};
use serenity::{async_trait, client::Client, model::id::GuildId, prelude::GatewayIntents};
use sessions::SessionState;
use songbird::{
    Event, EventContext, EventHandler as SongbirdEventHandler, SerenityInit, TrackEvent,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, Mutex},
};
use tracing::{error, warn};

#[derive(Clone)]
struct PlaybackTrackEventHandler {
    guild_id: String,
    stream_id: String,
    stage: &'static str,
    events: mpsc::UnboundedSender<SidecarEvent>,
    byte_count: Option<u64>,
}

#[async_trait]
impl SongbirdEventHandler for PlaybackTrackEventHandler {
    async fn act(&self, ctx: &EventContext<'_>) -> Option<Event> {
        let (message, position_ms) = match ctx {
            EventContext::Track(&[(state, _)]) => (
                format!("track_state={:?}", state.playing),
                Some(state.play_time.as_millis() as u64),
            ),
            EventContext::Track(tracks) => (format!("track_count={}", tracks.len()), None),
            _ => ("non_track_context".to_string(), None),
        };
        let _ = self.events.send(SidecarEvent::PlaybackDebug {
            guild_id: Some(self.guild_id.clone()),
            stream_id: self.stream_id.clone(),
            stage: self.stage.to_string(),
            message,
            byte_count: self.byte_count,
            position_ms,
        });
        if self.stage == "end" {
            let _ = self.events.send(SidecarEvent::PlaybackFinished {
                guild_id: Some(self.guild_id.clone()),
                stream_id: self.stream_id.clone(),
                chunk_count: 0,
                byte_count: self.byte_count.unwrap_or_default(),
            });
        }
        Some(Event::Cancel)
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let token = env::var("DISCORD_BOT_TOKEN").map_err(|_| SidecarError::MissingToken)?;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<SidecarEvent>();
    let discord_state = discord::DiscordState::new();

    let intents = GatewayIntents::non_privileged() | GatewayIntents::GUILD_VOICE_STATES;
    let mut client = Client::builder(token, intents)
        .event_handler(discord::Handler {
            state: discord_state.clone(),
            events: event_tx.clone(),
        })
        .register_songbird_from_config(voice::songbird_config())
        .await?;

    tokio::spawn(async move {
        if let Err(error) = client.start().await {
            error!(?error, "serenity client ended");
        }
    });

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<SidecarOutput>();
    let output_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(output) = out_rx.recv().await {
            match serde_json::to_vec(&output) {
                Ok(mut bytes) => {
                    bytes.push(b'\n');
                    if stdout.write_all(&bytes).await.is_err() {
                        break;
                    }
                    let _ = stdout.flush().await;
                }
                Err(error) => {
                    error!(?error, "failed to serialize protocol output");
                }
            }
        }
    });

    let bridge_out = out_tx.clone();
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = bridge_out.send(SidecarOutput::Event(event));
        }
    });

    let session_state = Mutex::new(SessionState::default());
    let playback_state = Mutex::new(PlaybackState::default());
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let command = match serde_json::from_str::<SidecarCommand>(&line) {
            Ok(command) => command,
            Err(error) => {
                let _ = out_tx.send(SidecarOutput::Event(SidecarEvent::Error {
                    code: "JsonParseError".into(),
                    message: error.to_string(),
                    request_id: None,
                }));
                continue;
            }
        };
        let request_id = command.id().map(str::to_owned);
        let shutdown = matches!(command, SidecarCommand::Shutdown { .. });
        let result = handle_command(
            command,
            &discord_state,
            &session_state,
            &playback_state,
            event_tx.clone(),
            out_tx.clone(),
        )
        .await;
        if let Some(id) = request_id {
            let _ = out_tx.send(SidecarOutput::Response {
                id,
                ok: result.is_ok(),
                error: result.err().map(|error| error.to_string()),
            });
        } else if let Err(error) = result {
            let _ = out_tx.send(SidecarOutput::Event(SidecarEvent::Error {
                code: "CommandError".into(),
                message: error.to_string(),
                request_id: None,
            }));
        }
        if shutdown {
            break;
        }
    }

    warn!("sidecar shutting down");
    drop(out_tx);
    let _ = output_task.await;
    Ok(())
}

async fn handle_command(
    command: SidecarCommand,
    discord_state: &discord::DiscordState,
    session_state: &Mutex<SessionState>,
    playback_state: &Mutex<PlaybackState>,
    events: mpsc::UnboundedSender<SidecarEvent>,
    out: mpsc::UnboundedSender<SidecarOutput>,
) -> Result<()> {
    match command {
        SidecarCommand::JoinVoice {
            guild_id,
            channel_id,
            ..
        } => {
            let context = discord_state
                .context()
                .await
                .ok_or(SidecarError::DiscordNotReady)?;
            let mut state = session_state.lock().await;
            let session =
                voice::join_voice(&context, &mut state, events, &guild_id, &channel_id).await?;
            let _ = out.send(SidecarOutput::Event(SidecarEvent::JoinedVoice {
                guild_id: session.guild_id,
                channel_id: session.channel_id,
                session_id: session.session_id,
            }));
        }
        SidecarCommand::LeaveVoice { guild_id, .. } => {
            let context = discord_state
                .context()
                .await
                .ok_or(SidecarError::DiscordNotReady)?;
            let mut state = session_state.lock().await;
            let session = voice::leave_voice(&context, &mut state, &guild_id).await?;
            let _ = out.send(SidecarOutput::Event(SidecarEvent::LeftVoice {
                guild_id: Some(guild_id),
                session_id: session.map(|value| value.session_id),
            }));
        }
        SidecarCommand::StartReceive { guild_id, .. } => {
            let state = session_state.lock().await;
            let session = state.get(&guild_id).ok_or(SidecarError::NotJoined)?;
            session.set_receive_enabled(true);
            let _ = out.send(SidecarOutput::Event(SidecarEvent::VoiceDebug {
                stage: "receive_enabled".into(),
                message: "sidecar receive events are enabled".into(),
                guild_id: Some(session.guild_id.clone()),
                channel_id: Some(session.channel_id.clone()),
                session_id: Some(session.session_id.clone()),
                user_id: None,
                ssrc: None,
                byte_count: None,
            }));
        }
        SidecarCommand::StopReceive { guild_id, .. } => {
            let state = session_state.lock().await;
            let session = state.get(&guild_id).ok_or(SidecarError::NotJoined)?;
            session.set_receive_enabled(false);
            let _ = out.send(SidecarOutput::Event(SidecarEvent::VoiceDebug {
                stage: "receive_disabled".into(),
                message: "sidecar receive events are disabled".into(),
                guild_id: Some(session.guild_id.clone()),
                channel_id: Some(session.channel_id.clone()),
                session_id: Some(session.session_id.clone()),
                user_id: None,
                ssrc: None,
                byte_count: None,
            }));
        }
        SidecarCommand::PlayAudioStreamBegin {
            guild_id,
            stream_id,
            format,
            ..
        } => {
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
                stage: "command_received".into(),
                message: format!("format={format}"),
                byte_count: None,
                position_ms: None,
            }));
            let context = discord_state
                .context()
                .await
                .ok_or(SidecarError::DiscordNotReady)?;
            let state = session_state.lock().await;
            let session = state.get(&guild_id).ok_or(SidecarError::NotJoined)?.clone();
            drop(state);
            let guild = GuildId::new(
                session
                    .guild_id
                    .parse()
                    .map_err(|_| SidecarError::InvalidId(session.guild_id.clone()))?,
            );
            let manager = songbird::get(&context)
                .await
                .ok_or(SidecarError::DiscordNotReady)?
                .clone();
            let handler_lock = manager.get(guild).ok_or(SidecarError::NotJoined)?;
            let input = playback_state.lock().await.begin(&stream_id, &format)?;
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
                stage: "input_created".into(),
                message: "streaming raw adapter input created".into(),
                byte_count: None,
                position_ms: None,
            }));
            {
                let mut handler = handler_lock.lock().await;
                let handle = handler.play_input(input);
                let _ = handle.add_event(
                    Event::Track(TrackEvent::Playable),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "playable",
                        events: events.clone(),
                        byte_count: None,
                    },
                );
                let _ = handle.add_event(
                    Event::Track(TrackEvent::Error),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "error",
                        events: events.clone(),
                        byte_count: None,
                    },
                );
                let _ = handle.add_event(
                    Event::Track(TrackEvent::End),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "end",
                        events: events.clone(),
                        byte_count: None,
                    },
                );
                let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                    guild_id: Some(guild_id.clone()),
                    stream_id: stream_id.clone(),
                    stage: "track_submitted".into(),
                    message: "stream track handle submitted with playable/error/end events".into(),
                    byte_count: None,
                    position_ms: None,
                }));
            }
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackStarted {
                guild_id: Some(guild_id),
                stream_id,
            }));
        }
        SidecarCommand::PlayAudioStreamChunk {
            stream_id,
            bytes_base64,
            ..
        } => {
            let bytes = STANDARD
                .decode(bytes_base64)
                .map_err(|_| SidecarError::InvalidId("invalid base64 audio chunk".into()))?;
            let stats = playback_state.lock().await.push(&stream_id, &bytes)?;
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackChunk {
                guild_id: None,
                stream_id,
                chunk_count: stats.chunk_count,
                byte_count: stats.byte_count,
            }));
        }
        SidecarCommand::PlayAudioStreamEnd { stream_id, .. } => {
            let stats = playback_state.lock().await.end(&stream_id);
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: None,
                stream_id,
                stage: "input_closed".into(),
                message: format!(
                    "stream input closed chunk_count={}",
                    stats
                        .as_ref()
                        .map(|value| value.chunk_count)
                        .unwrap_or_default()
                ),
                byte_count: Some(
                    stats
                        .as_ref()
                        .map(|value| value.byte_count)
                        .unwrap_or_default(),
                ),
                position_ms: None,
            }));
        }
        SidecarCommand::PlayAudioFile {
            guild_id,
            stream_id,
            path,
            format,
            ..
        } => {
            let byte_count = std::fs::metadata(&path).ok().map(|value| value.len());
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
                stage: "command_received".into(),
                message: format!("path={path} format={format}"),
                byte_count,
                position_ms: None,
            }));
            let context = discord_state
                .context()
                .await
                .ok_or(SidecarError::DiscordNotReady)?;
            let state = session_state.lock().await;
            let session = state.get(&guild_id).ok_or(SidecarError::NotJoined)?.clone();
            drop(state);
            let guild = GuildId::new(
                session
                    .guild_id
                    .parse()
                    .map_err(|_| SidecarError::InvalidId(session.guild_id.clone()))?,
            );
            let manager = songbird::get(&context)
                .await
                .ok_or(SidecarError::DiscordNotReady)?
                .clone();
            let handler_lock = manager.get(guild).ok_or(SidecarError::NotJoined)?;
            let (input, input_message) = if format.starts_with("wav_") {
                (
                    playback::create_wav_file_input(&path, &format)?,
                    "wav file input created",
                )
            } else {
                let _ = playback::validate_f32_file_input(&path, &format)?;
                (
                    playback::create_f32_file_input(&path, &format)?,
                    "raw adapter input created",
                )
            };
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
                stage: "file_validated".into(),
                message: format!("file validated as {format}"),
                byte_count,
                position_ms: None,
            }));
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
                stage: "input_created".into(),
                message: input_message.into(),
                byte_count,
                position_ms: None,
            }));
            {
                let mut handler = handler_lock.lock().await;
                let handle = handler.play_only_input(input);
                let _ = handle.add_event(
                    Event::Track(TrackEvent::Playable),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "playable",
                        events: events.clone(),
                        byte_count,
                    },
                );
                let _ = handle.add_event(
                    Event::Track(TrackEvent::Error),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "error",
                        events: events.clone(),
                        byte_count,
                    },
                );
                let _ = handle.add_event(
                    Event::Track(TrackEvent::End),
                    PlaybackTrackEventHandler {
                        guild_id: guild_id.clone(),
                        stream_id: stream_id.clone(),
                        stage: "end",
                        events: events.clone(),
                        byte_count,
                    },
                );
                let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                    guild_id: Some(guild_id.clone()),
                    stream_id: stream_id.clone(),
                    stage: "track_submitted".into(),
                    message: "track handle submitted with playable/error/end events".into(),
                    byte_count,
                    position_ms: None,
                }));
            }
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackStarted {
                guild_id: Some(guild_id.clone()),
                stream_id: stream_id.clone(),
            }));
            let probe_events = events.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let _ = probe_events.send(SidecarEvent::PlaybackDebug {
                    guild_id: Some(guild_id),
                    stream_id,
                    stage: "two_second_probe".into(),
                    message: "track should be audible or about to be audible".into(),
                    byte_count,
                    position_ms: None,
                });
            });
        }
        SidecarCommand::StopPlayback { guild_id, .. } => {
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                guild_id: Some(guild_id.clone()),
                stream_id: "all".into(),
                stage: "stop_requested".into(),
                message: "stop playback requested".into(),
                byte_count: None,
                position_ms: None,
            }));
            let stream_ids = playback_state.lock().await.stream_ids();
            for stream_id in stream_ids {
                let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackDebug {
                    guild_id: Some(guild_id.clone()),
                    stream_id,
                    stage: "stop_requested".into(),
                    message: "stop playback requested for active stream".into(),
                    byte_count: None,
                    position_ms: None,
                }));
            }
            playback_state.lock().await.stop();
            if let Some(context) = discord_state.context().await {
                let state = session_state.lock().await;
                if let Some(session) = state.get(&guild_id) {
                    let guild = GuildId::new(
                        session
                            .guild_id
                            .parse()
                            .map_err(|_| SidecarError::InvalidId(session.guild_id.clone()))?,
                    );
                    if let Some(manager) = songbird::get(&context).await {
                        if let Some(handler_lock) = manager.get(guild) {
                            handler_lock.lock().await.stop();
                        }
                    }
                }
            }
        }
        SidecarCommand::EmitFakeUserAudio {
            user_id,
            pcm_s16le_base64,
            sample_rate,
            channels,
            ..
        } => {
            let _ = out.send(SidecarOutput::Event(SidecarEvent::UserAudioChunk {
                guild_id: "fake-guild".into(),
                channel_id: "fake-channel".into(),
                session_id: "fake-session".into(),
                user_id,
                pcm_s16le_base64,
                sample_rate,
                channels,
                timestamp_ms: 0,
            }));
        }
        SidecarCommand::Shutdown { .. } => {
            // Shutdown is the sidecar backstop; TypeScript runtime disposal should leave first.
            if let Some(context) = discord_state.context().await {
                let guild_ids = session_state.lock().await.guild_ids();
                for guild_id in guild_ids {
                    let mut state = session_state.lock().await;
                    let session = voice::leave_voice(&context, &mut state, &guild_id).await?;
                    drop(state);
                    let _ = out.send(SidecarOutput::Event(SidecarEvent::LeftVoice {
                        guild_id: Some(guild_id),
                        session_id: session.map(|value| value.session_id),
                    }));
                }
            }
        }
    }
    Ok(())
}

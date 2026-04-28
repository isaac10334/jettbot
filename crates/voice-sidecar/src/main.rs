mod audio;
mod discord;
mod errors;
mod playback;
mod protocol;
mod sessions;
mod voice;

use std::env;

use base64::{engine::general_purpose::STANDARD, Engine};
use errors::{Result, SidecarError};
use playback::PlaybackState;
use protocol::{SidecarCommand, SidecarEvent, SidecarOutput};
use serenity::{client::Client, prelude::GatewayIntents};
use sessions::SessionState;
use songbird::SerenityInit;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, Mutex},
};
use tracing::{error, warn};

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
        SidecarCommand::LeaveVoice { .. } => {
            let context = discord_state
                .context()
                .await
                .ok_or(SidecarError::DiscordNotReady)?;
            let mut state = session_state.lock().await;
            let session = voice::leave_voice(&context, &mut state).await?;
            let _ = out.send(SidecarOutput::Event(SidecarEvent::LeftVoice {
                session_id: session.map(|value| value.session_id),
            }));
        }
        SidecarCommand::StartReceive { .. } | SidecarCommand::StopReceive { .. } => {}
        SidecarCommand::PlayAudioStreamBegin {
            stream_id, format, ..
        } => {
            let _format = format;
            playback_state.lock().await.begin(&stream_id);
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackStarted {
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
            playback_state.lock().await.push(&stream_id, &bytes)?;
        }
        SidecarCommand::PlayAudioStreamEnd { stream_id, .. } => {
            let _bytes = playback_state.lock().await.end(&stream_id);
            let _ = out.send(SidecarOutput::Event(SidecarEvent::PlaybackFinished {
                stream_id,
            }));
        }
        SidecarCommand::StopPlayback { .. } => playback_state.lock().await.stop(),
        SidecarCommand::EmitFakeUserAudio {
            user_id,
            pcm_s16le_base64,
            sample_rate,
            channels,
            ..
        } => {
            let _ = out.send(SidecarOutput::Event(SidecarEvent::UserAudioChunk {
                user_id,
                pcm_s16le_base64,
                sample_rate,
                channels,
                timestamp_ms: 0,
            }));
        }
        SidecarCommand::Shutdown { .. } => {}
    }
    Ok(())
}

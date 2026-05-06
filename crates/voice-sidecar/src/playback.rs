use std::{
    collections::HashMap,
    fs::File as StdFile,
    io::{ErrorKind as IoErrorKind, Read, Result as IoResult, Seek, SeekFrom},
    sync::{
        mpsc::{self, Receiver, Sender},
        Mutex,
    },
};

use songbird::input::core::io::MediaSource;
use songbird::input::{File as SongbirdFile, Input, RawAdapter};

use crate::errors::{Result, SidecarError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmPlaybackFormat {
    pub sample_rate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackChunkStats {
    pub chunk_count: u64,
    pub byte_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackEndStats {
    pub chunk_count: u64,
    pub byte_count: u64,
}

#[derive(Debug)]
struct PcmPlaybackStream {
    sender: Sender<Vec<u8>>,
    chunk_count: u64,
    byte_count: u64,
    pending_byte: Option<u8>,
}

#[derive(Debug, Default)]
pub struct PlaybackState {
    streams: HashMap<String, PcmPlaybackStream>,
}

impl PlaybackState {
    pub fn begin(&mut self, stream_id: &str, format: &str) -> Result<Input> {
        let format = parse_pcm_playback_format(format)?;
        let (sender, receiver) = mpsc::channel();
        let reader = PcmPlaybackReader::new(receiver);
        let input = RawAdapter::new(reader, format.sample_rate, format.channels).into();
        self.streams.insert(
            stream_id.to_string(),
            PcmPlaybackStream {
                sender,
                chunk_count: 0,
                byte_count: 0,
                pending_byte: None,
            },
        );
        Ok(input)
    }

    pub fn push(&mut self, stream_id: &str, bytes: &[u8]) -> Result<PlaybackChunkStats> {
        let Some(buffer) = self.streams.get_mut(stream_id) else {
            return Err(SidecarError::NotJoined);
        };
        let mut aligned =
            Vec::with_capacity(bytes.len() + usize::from(buffer.pending_byte.is_some()));
        if let Some(byte) = buffer.pending_byte.take() {
            aligned.push(byte);
        }
        aligned.extend_from_slice(bytes);
        if aligned.len() % 2 == 1 {
            buffer.pending_byte = aligned.pop();
        }
        if !aligned.is_empty() {
            let f32_bytes = pcm_s16le_to_f32le(&aligned)?;
            buffer
                .sender
                .send(f32_bytes)
                .map_err(|_| SidecarError::InvalidAudioFormat("playback reader ended".into()))?;
        }
        buffer.chunk_count += 1;
        buffer.byte_count += bytes.len() as u64;
        Ok(PlaybackChunkStats {
            chunk_count: buffer.chunk_count,
            byte_count: buffer.byte_count,
        })
    }

    pub fn end(&mut self, stream_id: &str) -> Option<PlaybackEndStats> {
        self.streams
            .remove(stream_id)
            .map(|stream| PlaybackEndStats {
                chunk_count: stream.chunk_count,
                byte_count: stream.byte_count,
            })
    }

    pub fn stop(&mut self) {
        self.streams.clear();
    }

    pub fn stream_ids(&self) -> Vec<String> {
        self.streams.keys().cloned().collect()
    }
}

pub fn create_f32_file_input(path: &str, format: &str) -> Result<Input> {
    let format = parse_f32_playback_format(format)?;
    let reader = F32FilePlaybackReader::open(path)?;
    Ok(RawAdapter::new(reader, format.sample_rate, format.channels).into())
}

pub fn create_wav_file_input(path: &str, format: &str) -> Result<Input> {
    let _ = validate_wav_file_input(path, format)?;
    Ok(SongbirdFile::new(path.to_string()).into())
}

pub fn validate_f32_file_input(path: &str, format: &str) -> Result<PcmPlaybackFormat> {
    let format = parse_f32_playback_format(format)?;
    let metadata = std::fs::metadata(path)
        .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
    let frame_bytes = u64::from(format.channels) * 4;
    if metadata.len() == 0 {
        return Err(SidecarError::InvalidAudioFormat(
            "empty f32 PCM file".into(),
        ));
    }
    if metadata.len() % frame_bytes != 0 {
        return Err(SidecarError::InvalidAudioFormat(format!(
            "f32 PCM byte length {} is not aligned to {} bytes per frame",
            metadata.len(),
            frame_bytes
        )));
    }
    Ok(format)
}

pub fn validate_wav_file_input(path: &str, format: &str) -> Result<PcmPlaybackFormat> {
    let expected = parse_wav_playback_format(format)?;
    let mut file =
        StdFile::open(path).map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
    let mut riff = [0_u8; 12];
    file.read_exact(&mut riff)
        .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;

    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err(SidecarError::InvalidAudioFormat(
            "not a RIFF/WAVE file".into(),
        ));
    }

    let mut fmt: Option<(u16, u32, u32, u16)> = None;
    let mut data_bytes: Option<u32> = None;
    loop {
        let mut chunk_header = [0_u8; 8];
        match file.read_exact(&mut chunk_header) {
            Ok(()) => {}
            Err(error) if error.kind() == IoErrorKind::UnexpectedEof => break,
            Err(error) => return Err(SidecarError::InvalidAudioFormat(error.to_string())),
        }

        let chunk_id = &chunk_header[0..4];
        let chunk_size = u32::from_le_bytes([
            chunk_header[4],
            chunk_header[5],
            chunk_header[6],
            chunk_header[7],
        ]);
        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err(SidecarError::InvalidAudioFormat(
                    "WAV fmt chunk is too small".into(),
                ));
            }
            let mut chunk = vec![0_u8; chunk_size as usize];
            file.read_exact(&mut chunk)
                .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
            let audio_format = u16::from_le_bytes([chunk[0], chunk[1]]);
            let channels = u16::from_le_bytes([chunk[2], chunk[3]]) as u32;
            let sample_rate = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);
            let bits_per_sample = u16::from_le_bytes([chunk[14], chunk[15]]);
            fmt = Some((audio_format, channels, sample_rate, bits_per_sample));
        } else {
            if chunk_id == b"data" {
                data_bytes = Some(chunk_size);
            }
            file.seek(SeekFrom::Current(i64::from(chunk_size)))
                .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
        }

        if chunk_size % 2 == 1 {
            file.seek(SeekFrom::Current(1))
                .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
        }

        if fmt.is_some() && data_bytes.is_some() {
            break;
        }
    }

    let Some((audio_format, channels, sample_rate, bits_per_sample)) = fmt else {
        return Err(SidecarError::InvalidAudioFormat(
            "WAV fmt chunk missing".into(),
        ));
    };
    let Some(data_bytes) = data_bytes else {
        return Err(SidecarError::InvalidAudioFormat(
            "WAV data chunk missing".into(),
        ));
    };
    if audio_format != 1 {
        return Err(SidecarError::InvalidAudioFormat(format!(
            "WAV audio format must be PCM 1, got {audio_format}"
        )));
    }
    if sample_rate != expected.sample_rate || channels != expected.channels {
        return Err(SidecarError::InvalidAudioFormat(format!(
            "WAV format mismatch: expected {}Hz {}ch, got {}Hz {}ch",
            expected.sample_rate, expected.channels, sample_rate, channels
        )));
    }
    if bits_per_sample != 16 {
        return Err(SidecarError::InvalidAudioFormat(format!(
            "WAV bits per sample must be 16, got {bits_per_sample}"
        )));
    }
    if data_bytes == 0 {
        return Err(SidecarError::InvalidAudioFormat("empty WAV data".into()));
    }
    Ok(expected)
}

#[derive(Debug)]
pub struct F32FilePlaybackReader {
    file: StdFile,
    byte_len: u64,
}

impl F32FilePlaybackReader {
    pub fn open(path: &str) -> Result<Self> {
        let file = StdFile::open(path)
            .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?;
        let byte_len = file
            .metadata()
            .map_err(|error| SidecarError::InvalidAudioFormat(error.to_string()))?
            .len();
        Ok(Self { file, byte_len })
    }
}

impl Read for F32FilePlaybackReader {
    fn read(&mut self, output: &mut [u8]) -> IoResult<usize> {
        self.file.read(output)
    }
}

impl Seek for F32FilePlaybackReader {
    fn seek(&mut self, _pos: SeekFrom) -> IoResult<u64> {
        Err(IoErrorKind::Unsupported.into())
    }
}

impl MediaSource for F32FilePlaybackReader {
    fn is_seekable(&self) -> bool {
        false
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.byte_len)
    }
}

#[derive(Debug)]
pub struct PcmPlaybackReader {
    receiver: Mutex<Receiver<Vec<u8>>>,
    current: Vec<u8>,
    current_offset: usize,
    ended: bool,
}

impl PcmPlaybackReader {
    pub fn new(receiver: Receiver<Vec<u8>>) -> Self {
        Self {
            receiver: Mutex::new(receiver),
            current: Vec::new(),
            current_offset: 0,
            ended: false,
        }
    }
}

impl Read for PcmPlaybackReader {
    fn read(&mut self, output: &mut [u8]) -> IoResult<usize> {
        if output.is_empty() {
            return Ok(0);
        }

        while self.current_offset >= self.current.len() {
            if self.ended {
                return Ok(0);
            }
            match self
                .receiver
                .lock()
                .expect("playback receiver poisoned")
                .recv()
            {
                Ok(next) => {
                    self.current = next;
                    self.current_offset = 0;
                }
                Err(_) => {
                    self.ended = true;
                    return Ok(0);
                }
            }
        }

        let remaining = self.current.len() - self.current_offset;
        let count = remaining.min(output.len());
        output[..count]
            .copy_from_slice(&self.current[self.current_offset..self.current_offset + count]);
        self.current_offset += count;
        Ok(count)
    }
}

impl Seek for PcmPlaybackReader {
    fn seek(&mut self, _pos: SeekFrom) -> IoResult<u64> {
        Err(IoErrorKind::Unsupported.into())
    }
}

impl MediaSource for PcmPlaybackReader {
    fn is_seekable(&self) -> bool {
        false
    }

    fn byte_len(&self) -> Option<u64> {
        None
    }
}

pub fn parse_pcm_playback_format(value: &str) -> Result<PcmPlaybackFormat> {
    if let Some(sample_rate) = value.strip_prefix("pcm_") {
        let parsed = sample_rate
            .parse::<u32>()
            .map_err(|_| SidecarError::InvalidAudioFormat(value.into()))?;
        return Ok(PcmPlaybackFormat {
            sample_rate: parsed,
            channels: 1,
        });
    }

    let parts: Vec<&str> = value.split('_').collect();
    if parts.len() == 4 && parts[0] == "pcm" && parts[1] == "s16le" {
        let sample_rate = parts[2]
            .parse::<u32>()
            .map_err(|_| SidecarError::InvalidAudioFormat(value.into()))?;
        let channels = match parts[3] {
            "mono" => 1,
            "stereo" => 2,
            _ => return Err(SidecarError::InvalidAudioFormat(value.into())),
        };
        return Ok(PcmPlaybackFormat {
            sample_rate,
            channels,
        });
    }

    Err(SidecarError::InvalidAudioFormat(value.into()))
}

pub fn parse_f32_playback_format(value: &str) -> Result<PcmPlaybackFormat> {
    let parts: Vec<&str> = value.split('_').collect();
    if parts.len() == 4 && parts[0] == "pcm" && parts[1] == "f32le" {
        let sample_rate = parts[2]
            .parse::<u32>()
            .map_err(|_| SidecarError::InvalidAudioFormat(value.into()))?;
        let channels = match parts[3] {
            "mono" => 1,
            "stereo" => 2,
            _ => return Err(SidecarError::InvalidAudioFormat(value.into())),
        };
        return Ok(PcmPlaybackFormat {
            sample_rate,
            channels,
        });
    }

    Err(SidecarError::InvalidAudioFormat(value.into()))
}

pub fn parse_wav_playback_format(value: &str) -> Result<PcmPlaybackFormat> {
    let parts: Vec<&str> = value.split('_').collect();
    if parts.len() == 5 && parts[0] == "wav" && parts[1] == "pcm" && parts[2] == "s16le" {
        let sample_rate = parts[3]
            .parse::<u32>()
            .map_err(|_| SidecarError::InvalidAudioFormat(value.into()))?;
        let channels = match parts[4] {
            "mono" => 1,
            "stereo" => 2,
            _ => return Err(SidecarError::InvalidAudioFormat(value.into())),
        };
        return Ok(PcmPlaybackFormat {
            sample_rate,
            channels,
        });
    }

    Err(SidecarError::InvalidAudioFormat(value.into()))
}

pub fn pcm_s16le_to_f32le(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() % 2 != 0 {
        return Err(SidecarError::InvalidAudioFormat(format!(
            "odd PCM byte length: {}",
            bytes.len()
        )));
    }

    let mut output = Vec::with_capacity(bytes.len() * 2);
    for sample in bytes.chunks_exact(2) {
        let value = i16::from_le_bytes([sample[0], sample[1]]);
        let normalized = f32::from(value) / 32768.0;
        output.extend_from_slice(&normalized.to_le_bytes());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn parses_elevenlabs_pcm_format() {
        assert_eq!(
            parse_pcm_playback_format("pcm_24000").unwrap(),
            PcmPlaybackFormat {
                sample_rate: 24_000,
                channels: 1
            }
        );
    }

    #[test]
    fn converts_s16le_to_f32le() {
        let bytes = pcm_s16le_to_f32le(&[0, 0, 0, 64]).unwrap();
        assert_eq!(bytes.len(), 8);
        let first = f32::from_le_bytes(bytes[0..4].try_into().unwrap());
        let second = f32::from_le_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(first, 0.0);
        assert_eq!(second, 0.5);
    }

    #[test]
    fn reader_drains_chunks_then_ends() {
        let (sender, receiver) = mpsc::channel();
        sender.send(vec![1, 2, 3]).unwrap();
        drop(sender);

        let mut reader = PcmPlaybackReader::new(receiver);
        let mut first = [0; 2];
        assert_eq!(reader.read(&mut first).unwrap(), 2);
        assert_eq!(first, [1, 2]);

        let mut second = [0; 2];
        assert_eq!(reader.read(&mut second).unwrap(), 1);
        assert_eq!(second[0], 3);
        assert_eq!(reader.read(&mut second).unwrap(), 0);
    }

    #[test]
    fn parses_f32_file_format() {
        assert_eq!(
            parse_f32_playback_format("pcm_f32le_48000_stereo").unwrap(),
            PcmPlaybackFormat {
                sample_rate: 48_000,
                channels: 2
            }
        );
    }

    #[test]
    fn parses_wav_file_format() {
        assert_eq!(
            parse_wav_playback_format("wav_pcm_s16le_48000_stereo").unwrap(),
            PcmPlaybackFormat {
                sample_rate: 48_000,
                channels: 2
            }
        );
    }

    fn write_test_wav(path: &std::path::Path) {
        let mut bytes = vec![0_u8; 48];
        bytes[0..4].copy_from_slice(b"RIFF");
        bytes[4..8].copy_from_slice(&(40_u32).to_le_bytes());
        bytes[8..12].copy_from_slice(b"WAVE");
        bytes[12..16].copy_from_slice(b"fmt ");
        bytes[16..20].copy_from_slice(&(16_u32).to_le_bytes());
        bytes[20..22].copy_from_slice(&(1_u16).to_le_bytes());
        bytes[22..24].copy_from_slice(&(2_u16).to_le_bytes());
        bytes[24..28].copy_from_slice(&(48_000_u32).to_le_bytes());
        bytes[28..32].copy_from_slice(&(192_000_u32).to_le_bytes());
        bytes[32..34].copy_from_slice(&(4_u16).to_le_bytes());
        bytes[34..36].copy_from_slice(&(16_u16).to_le_bytes());
        bytes[36..40].copy_from_slice(b"data");
        bytes[40..44].copy_from_slice(&(4_u32).to_le_bytes());
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn validates_wav_file_input() {
        let mut path = std::env::temp_dir();
        path.push(format!("jettbot-sidecar-test-{}.wav", std::process::id()));
        write_test_wav(&path);
        let result = validate_wav_file_input(path.to_str().unwrap(), "wav_pcm_s16le_48000_stereo");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            result.unwrap(),
            PcmPlaybackFormat {
                sample_rate: 48_000,
                channels: 2
            }
        );
    }

    #[test]
    fn rejects_misaligned_f32_file_input() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "jettbot-sidecar-misaligned-{}.f32le",
            std::process::id()
        ));
        std::fs::write(&path, [0_u8; 6]).unwrap();
        let result = validate_f32_file_input(path.to_str().unwrap(), "pcm_f32le_48000_stereo");
        let _ = std::fs::remove_file(&path);
        assert!(result.is_err());
    }

    #[test]
    fn f32_file_reader_is_not_seekable() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "jettbot-sidecar-reader-{}.f32le",
            std::process::id()
        ));
        std::fs::write(&path, [0_u8; 8]).unwrap();
        let mut reader = F32FilePlaybackReader::open(path.to_str().unwrap()).unwrap();
        let _ = std::fs::remove_file(&path);

        assert!(!reader.is_seekable());
        assert_eq!(reader.byte_len(), Some(8));
        assert!(reader.seek(SeekFrom::Start(0)).is_err());

        let mut bytes = [0_u8; 8];
        assert_eq!(reader.read(&mut bytes).unwrap(), 8);
    }

    #[test]
    fn playback_state_reports_stream_ids_before_stop() {
        let mut state = PlaybackState::default();
        let _ = state.begin("stream-a", "pcm_24000").unwrap();
        assert_eq!(state.stream_ids(), vec!["stream-a".to_string()]);
        state.stop();
        assert!(state.stream_ids().is_empty());
    }

    #[test]
    fn playback_state_carries_odd_pcm_byte_across_chunks() {
        let mut state = PlaybackState::default();
        let _input = state.begin("stream-a", "pcm_24000").unwrap();
        assert!(state.push("stream-a", &[0]).is_ok());
        let stats = state.push("stream-a", &[0]).unwrap();
        assert_eq!(stats.chunk_count, 2);
        assert_eq!(stats.byte_count, 2);
    }
}

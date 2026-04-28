use std::collections::HashMap;

use bytes::BytesMut;

use crate::errors::{Result, SidecarError};

#[derive(Debug, Default)]
pub struct PlaybackState {
    streams: HashMap<String, BytesMut>,
}

impl PlaybackState {
    pub fn begin(&mut self, stream_id: &str) {
        self.streams.insert(stream_id.to_string(), BytesMut::new());
    }

    pub fn push(&mut self, stream_id: &str, bytes: &[u8]) -> Result<()> {
        let Some(buffer) = self.streams.get_mut(stream_id) else {
            return Err(SidecarError::NotJoined);
        };
        buffer.extend_from_slice(bytes);
        Ok(())
    }

    pub fn end(&mut self, stream_id: &str) -> Option<Vec<u8>> {
        self.streams.remove(stream_id).map(|bytes| bytes.to_vec())
    }

    pub fn stop(&mut self) {
        self.streams.clear();
    }
}

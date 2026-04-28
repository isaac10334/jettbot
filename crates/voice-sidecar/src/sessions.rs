#[derive(Debug, Clone)]
pub struct VoiceSession {
    pub guild_id: String,
    pub channel_id: String,
    pub session_id: String,
}

#[derive(Debug, Default)]
pub struct SessionState {
    current: Option<VoiceSession>,
}

impl SessionState {
    pub fn current(&self) -> Option<&VoiceSession> {
        self.current.as_ref()
    }

    pub fn set(&mut self, session: VoiceSession) {
        self.current = Some(session);
    }

    pub fn take(&mut self) -> Option<VoiceSession> {
        self.current.take()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_tracks_session() {
        let mut state = SessionState::default();
        assert!(state.current().is_none());
        state.set(VoiceSession {
            guild_id: "1".into(),
            channel_id: "2".into(),
            session_id: "3".into(),
        });
        assert_eq!(state.current().unwrap().session_id, "3");
        assert_eq!(state.take().unwrap().guild_id, "1");
        assert!(state.current().is_none());
    }
}

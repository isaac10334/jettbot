use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct VoiceSession {
    pub guild_id: String,
    pub channel_id: String,
    pub session_id: String,
    receive_enabled: Arc<AtomicBool>,
}

impl VoiceSession {
    pub fn new(guild_id: String, channel_id: String, session_id: String) -> Self {
        Self {
            guild_id,
            channel_id,
            session_id,
            receive_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn receive_enabled(&self) -> Arc<AtomicBool> {
        self.receive_enabled.clone()
    }

    pub fn set_receive_enabled(&self, enabled: bool) {
        self.receive_enabled.store(enabled, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub fn is_receive_enabled(&self) -> bool {
        self.receive_enabled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Default)]
pub struct SessionState {
    sessions: HashMap<String, VoiceSession>,
}

impl SessionState {
    pub fn get(&self, guild_id: &str) -> Option<&VoiceSession> {
        self.sessions.get(guild_id)
    }

    pub fn set(&mut self, session: VoiceSession) {
        self.sessions.insert(session.guild_id.clone(), session);
    }

    pub fn take(&mut self, guild_id: &str) -> Option<VoiceSession> {
        self.sessions.remove(guild_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_tracks_session() {
        let mut state = SessionState::default();
        assert!(state.get("1").is_none());
        state.set(VoiceSession::new("1".into(), "2".into(), "3".into()));
        state.set(VoiceSession::new("4".into(), "5".into(), "6".into()));
        assert_eq!(state.get("1").unwrap().session_id, "3");
        assert_eq!(state.get("4").unwrap().session_id, "6");
        assert_eq!(state.take("1").unwrap().guild_id, "1");
        assert!(state.get("1").is_none());
        assert!(state.get("4").is_some());
    }

    #[test]
    fn session_controls_receive_state() {
        let session = VoiceSession::new("1".into(), "2".into(), "3".into());
        assert!(!session.is_receive_enabled());
        session.set_receive_enabled(true);
        assert!(session.is_receive_enabled());
    }
}

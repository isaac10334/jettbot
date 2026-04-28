use std::sync::Arc;

use serenity::{
    async_trait,
    client::{Context, EventHandler},
    model::gateway::Ready,
};
use tokio::sync::{mpsc::UnboundedSender, RwLock};
use tracing::info;

use crate::protocol::SidecarEvent;

#[derive(Clone)]
pub struct DiscordState {
    context: Arc<RwLock<Option<Context>>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self {
            context: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_context(&self, context: Context) {
        *self.context.write().await = Some(context);
    }

    pub async fn context(&self) -> Option<Context> {
        self.context.read().await.clone()
    }
}

pub struct Handler {
    pub state: DiscordState,
    pub events: UnboundedSender<SidecarEvent>,
}

#[async_trait]
impl EventHandler for Handler {
    async fn ready(&self, context: Context, ready: Ready) {
        info!(user = %ready.user.name, "discord sidecar connected");
        self.state.set_context(context).await;
        let _ = self.events.send(SidecarEvent::Ready);
    }
}

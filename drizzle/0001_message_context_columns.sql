ALTER TABLE messages ADD COLUMN source_id TEXT;
ALTER TABLE messages ADD COLUMN username TEXT;
ALTER TABLE messages ADD COLUMN display_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_source_id ON messages (source_id);

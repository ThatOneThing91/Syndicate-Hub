CREATE TABLE IF NOT EXISTS member_keys (
 key_hash TEXT PRIMARY KEY,
 key_prefix TEXT NOT NULL,
 user_id TEXT NOT NULL,
 expires_at TEXT,
 revoked INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_keys_user ON member_keys(user_id);

-- Lumora TV remote management (Cloudflare D1)
CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id = 1), pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, ts);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, name TEXT, pair_code TEXT, pair_expires INTEGER,
  claimed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_seen INTEGER,
  app_version TEXT, model TEXT, now_playing TEXT, report TEXT
);
CREATE INDEX IF NOT EXISTS devices_code ON devices (pair_code);
CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, name TEXT, type TEXT NOT NULL,
  server TEXT, user TEXT, pass TEXT, url TEXT, epg_url TEXT, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS playlists_device ON playlists (device_id);
CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, created INTEGER NOT NULL, done INTEGER);
CREATE INDEX IF NOT EXISTS commands_device ON commands (device_id, done);

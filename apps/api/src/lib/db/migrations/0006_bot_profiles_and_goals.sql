ALTER TABLE bot_controllers
  ADD COLUMN strategy_version VARCHAR(32) NOT NULL DEFAULT '1',
  ADD COLUMN profile VARCHAR(16) NOT NULL DEFAULT 'industrialist',
  ADD COLUMN active_goal_type VARCHAR(32),
  ADD COLUMN active_goal_target VARCHAR(128),
  ADD COLUMN goal_started_at TIMESTAMP,
  ADD COLUMN last_progress_at TIMESTAMP;

-- Assign deterministic profiles to existing bot controllers based on sorted usernames.
-- The profile is derived from the MD5 hash of the username, mapped to one of four values
-- using the remainder of the first 8 hex digits interpreted as an integer.
UPDATE bot_controllers
SET profile = CASE
  WHEN (('x' || substring(md5(u.username), 1, 8))::bit(32)::int % 4) = 0 THEN 'industrialist'
  WHEN (('x' || substring(md5(u.username), 1, 8))::bit(32)::int % 4) = 1 THEN 'pioneer'
  WHEN (('x' || substring(md5(u.username), 1, 8))::bit(32)::int % 4) = 2 THEN 'technocrat'
  ELSE 'warlord'
END
FROM users u
WHERE bot_controllers.user_id = u.id;

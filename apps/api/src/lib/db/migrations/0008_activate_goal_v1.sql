-- GB-19: Activate goal_v1 strategy for all bots
-- Change default strategy to goal_v1 and migrate existing controllers

ALTER TABLE bot_controllers ALTER COLUMN strategy SET DEFAULT 'goal_v1';
UPDATE bot_controllers SET strategy = 'goal_v1' WHERE strategy = 'economic_v1';

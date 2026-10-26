-- Adaptive bot goal weighting: profiles only provide start weights.
ALTER TABLE bot_controllers ADD COLUMN category_weights JSONB;

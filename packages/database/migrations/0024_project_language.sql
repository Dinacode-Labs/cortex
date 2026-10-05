ALTER TABLE entities ADD COLUMN IF NOT EXISTS language text CHECK (language IN ('es', 'en'));

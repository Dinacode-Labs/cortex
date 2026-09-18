-- The hardcoded CHECK on sources.source_type drifted every time a type was added
-- (codex, agent_session...). The source of truth is the `sourceType` zod enum in
-- @cortex/shared, which already validates in the app. The database CHECK is dropped so a
-- migration is not needed for every new source type.
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

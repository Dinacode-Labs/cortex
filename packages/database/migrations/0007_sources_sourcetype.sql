-- El CHECK hardcodeado de sources.source_type derivaba cada vez que añadíamos un tipo
-- (codex, agent_session…). La fuente de verdad es el enum zod `sourceType` en
-- @cortex/shared, que ya valida en la app. Quitamos el CHECK de la BD para no tener que
-- migrar por cada nuevo tipo de fuente.
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_check;

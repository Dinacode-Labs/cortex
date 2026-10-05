-- `module_note` becomes `other` (ADR-0079). It was the type a memo landed in when nothing else
-- fitted -- the heuristic classifier and the distiller both fall back to it -- and the name made
-- it read like a note about a module.
--
-- Idempotent: the CHECK is dropped and recreated, and the UPDATE finds nothing on a re-run. The
-- constraint was declared inline in 0001 and renamed with its table by 0022.
ALTER TABLE memos DROP CONSTRAINT IF EXISTS memos_type_check;

UPDATE memos SET type = 'other' WHERE type = 'module_note';

ALTER TABLE memos ADD CONSTRAINT memos_type_check CHECK (type IN (
  'decision','constraint','incident','architecture','technical_debt','convention',
  'business_rule','integration_note','risk','how_to','meeting_summary','pr_summary',
  'ticket_resolution','other'));

ALTER TABLE memos DROP CONSTRAINT IF EXISTS memos_type_check;

UPDATE memos SET type = 'other' WHERE type = 'module_note';

ALTER TABLE memos ADD CONSTRAINT memos_type_check CHECK (type IN (
  'decision','constraint','incident','architecture','technical_debt','convention',
  'business_rule','integration_note','risk','how_to','meeting_summary','pr_summary',
  'ticket_resolution','other'));

-- A person can settle a review by merging the memos into one that replaces them (ADR-0096).
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_resolution_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_resolution_check
  CHECK (resolution IN ('kept', 'discarded', 'modified', 'merged'));

-- A project that switches it on lets the nightly pass merge, with no person in between, the groups
-- its agent judged to say the same thing or to hold parts of one memo (ADR-0103). Off unless its
-- manager says otherwise, and not inherited: a child added later must not start merging unasked.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS auto_merge boolean NOT NULL DEFAULT false;

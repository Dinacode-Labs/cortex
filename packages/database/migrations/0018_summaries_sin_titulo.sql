-- Strip the repeated title from summaries that were already stored (ADR-0054).
--
-- The distiller writes content as "Title. Body..." and the summary is its first characters, so
-- summaries began by repeating the title: in one real project, 355 entries out of 355. The
-- pack renders title and summary one under the other, with ~47-character titles above
-- ~206-character summaries, so nearly a quarter of every entry said the same thing twice --
-- and the hook's budget is paid in entries that do not fit.
--
-- The fix in `saveContext` only acts on write, so without this the memory that already exists
-- takes months to benefit. The same rule as in the code applies here: strip only when the
-- summary really does start with the title and what is left is still a worthwhile summary.
--
-- The filename keeps its Spanish word on purpose: it is the primary key in
-- `schema_migrations`, so renaming it would re-run the migration on every existing install.

UPDATE context_entries
   SET summary = trim(leading ' .:;,-' from substr(summary, length(title) + 1))
 WHERE summary IS NOT NULL
   AND length(title) >= 8
   AND lower(left(summary, length(title))) = lower(title)
   AND length(trim(leading ' .:;,-' from substr(summary, length(title) + 1))) >= 40;

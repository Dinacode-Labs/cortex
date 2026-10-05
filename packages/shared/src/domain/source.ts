import { z } from "zod";

/** Where a piece of knowledge came from. Section 14, sources.source_type */
export const sourceType = z.enum([
  "manual",
  "claude_code",
  "github_pr",
  "github_issue",
  "jira_ticket",
  "notion_doc",
  "email",
  "chat",
  "meeting_transcript",
  "codex",
  "agent_session",
  "document",
]);
export type SourceType = z.infer<typeof sourceType>;

/** The original source of an entry. Section 14, sources */
export const source = z.object({
  id: z.string().uuid(),
  sourceType: sourceType,
  externalId: z.string().nullable(),
  url: z.string().nullable(),
  rawContent: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Source = z.infer<typeof source>;

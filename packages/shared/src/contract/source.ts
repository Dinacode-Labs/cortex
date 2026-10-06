import { z } from "zod";

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

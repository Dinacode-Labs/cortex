import type { SourceType } from "@cortex/shared";

export interface Source {
  id: string;
  sourceType: SourceType;
  externalId: string | null;
  url: string | null;
  rawContent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

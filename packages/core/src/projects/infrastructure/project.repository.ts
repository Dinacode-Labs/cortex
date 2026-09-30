import { getSql, type Sql } from "@cortex/database";
import { canonicalize } from "../../text.js";
import type { Row } from "../../storage/map.js";
import type { ProjectChainNode, ProjectRef } from "../domain/project.js";
import type { ProjectRepository } from "../domain/project-repository.js";

function toRef(r: Row | undefined): ProjectRef | null {
  if (!r) return null;
  return {
    id: r.id as string,
    name: r.name as string,
    slug: (r.slug as string) ?? null,
    visibility: ((r.visibility as string) ?? "public") === "private" ? "private" : "public",
    ownerEmail: (r.owner_email as string) ?? null,
    parentId: (r.parent_id as string) ?? null,
  };
}

export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly sql: Sql = getSql()) {}

  async findByRef(ref: string): Promise<ProjectRef | null> {
    const rows = (await this.sql`
      SELECT id, name, slug, visibility, owner_email, parent_id
        FROM entities
       WHERE type = 'project' AND (slug = ${ref} OR canonical_name = ${canonicalize(ref)})
       ORDER BY (slug = ${ref}) DESC
       LIMIT 1
    `) as unknown as Row[];
    return toRef(rows[0]);
  }

  async findBySlug(slug: string): Promise<ProjectRef | null> {
    const rows = (await this.sql`SELECT id, name, slug, visibility, owner_email, parent_id FROM entities WHERE type = 'project' AND slug = ${slug} LIMIT 1`) as unknown as Row[];
    return toRef(rows[0]);
  }

  async findIdByRef(ref: string): Promise<string | null> {
    const row = await this.findByRef(ref);
    return row ? row.id : null;
  }

  async resolveEntryProject(entryId: string): Promise<{ found: boolean; project: ProjectRef | null }> {
    const rows = (await this.sql`
      SELECT p.id, p.name, p.slug, p.visibility, p.owner_email, p.parent_id
      FROM context_entries ce LEFT JOIN entities p ON p.id = ce.project_id
      WHERE ce.id = ${entryId} LIMIT 1
    `) as unknown as Row[];
    if (rows.length === 0) return { found: false, project: null };
    return { found: true, project: rows[0]!.id ? toRef(rows[0]) : null };
  }

  async chain(projectId: string): Promise<ProjectChainNode[]> {
    const rows = (await this.sql`
      WITH RECURSIVE c AS (
        SELECT id, visibility, owner_email, parent_id FROM entities WHERE id = ${projectId}
        UNION ALL
        SELECT e.id, e.visibility, e.owner_email, e.parent_id FROM entities e JOIN c ON e.id = c.parent_id
      )
      SELECT id, visibility, owner_email FROM c
    `) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      visibility: (r.visibility as string) === "private" ? "private" : "public",
      ownerEmail: (r.owner_email as string) ?? null,
    }));
  }

  async isMember(projectId: string, email: string): Promise<boolean> {
    const r = (await this.sql`SELECT 1 FROM project_members WHERE project_id = ${projectId} AND email = ${email.toLowerCase()} LIMIT 1`) as unknown as unknown[];
    return r.length > 0;
  }

  async idsWithAncestors(projectId: string): Promise<string[]> {
    const rows = (await this.sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id FROM entities WHERE id = ${projectId}
        UNION ALL
        SELECT e.id, e.parent_id FROM entities e JOIN chain c ON e.id = c.parent_id
      )
      SELECT id FROM chain
    `) as unknown as Row[];
    return rows.map((r) => r.id as string);
  }

  async ancestors(projectId: string): Promise<ProjectRef[]> {
    const rows = (await this.sql`
      WITH RECURSIVE chain AS (
        SELECT id, name, slug, visibility, owner_email, parent_id, 0 AS depth
          FROM entities WHERE id = ${projectId}
        UNION ALL
        SELECT e.id, e.name, e.slug, e.visibility, e.owner_email, e.parent_id, c.depth + 1
          FROM entities e JOIN chain c ON e.id = c.parent_id
      )
      SELECT id, name, slug, visibility, owner_email, parent_id FROM chain WHERE depth > 0
       ORDER BY depth DESC
    `) as unknown as Row[];
    return rows.map(toRef).filter((r): r is ProjectRef => r !== null);
  }

  async listAll(): Promise<ProjectRef[]> {
    const rows = (await this.sql`SELECT id, name, slug, visibility, owner_email, parent_id FROM entities WHERE type = 'project' ORDER BY name`) as unknown as Row[];
    return rows.map(toRef).filter((r): r is ProjectRef => r !== null);
  }

  async entryCounts(): Promise<Map<string, number>> {
    const rows = (await this.sql`SELECT project_id, count(*)::int AS entry_count FROM context_entries WHERE project_id IS NOT NULL GROUP BY project_id`) as unknown as Row[];
    return new Map(rows.map((r) => [r.project_id as string, Number(r.entry_count)]));
  }
}

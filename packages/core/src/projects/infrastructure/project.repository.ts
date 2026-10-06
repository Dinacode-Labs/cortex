import { getSql, type Sql } from "@cortex/database";
import type { Language, ProjectCriteria } from "@cortex/shared";
import { canonicalize } from "../../text.js";
import type { Row } from "../../storage/map.js";
import type { ProjectChainNode, ProjectRef } from "../domain/project.js";
import type { NewProject, ProjectChanges, ProjectRepository } from "../domain/project-repository.js";

type JsonValue = Parameters<Sql["json"]>[0];

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
      FROM memos m LEFT JOIN entities p ON p.id = m.project_id
      WHERE m.id = ${entryId} LIMIT 1
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
    const rows = (await this.sql`SELECT project_id, count(*)::int AS entry_count FROM memos WHERE project_id IS NOT NULL GROUP BY project_id`) as unknown as Row[];
    return new Map(rows.map((r) => [r.project_id as string, Number(r.entry_count)]));
  }

  async findByIds(ids: string[]): Promise<ProjectRef[]> {
    const rows = (await this.sql`
      SELECT id, name, slug, visibility, owner_email, parent_id FROM entities
      WHERE type = 'project' AND id = ANY(${ids})
    `) as unknown as Row[];
    return rows.map(toRef).filter((r): r is ProjectRef => r !== null);
  }

  async findByCanonicalName(name: string): Promise<ProjectRef | null> {
    const rows = (await this.sql`
      SELECT id, name, slug, visibility, owner_email, parent_id FROM entities
      WHERE type = 'project' AND canonical_name = ${canonicalize(name)} LIMIT 1
    `) as unknown as Row[];
    return toRef(rows[0]);
  }

  async insert(project: NewProject): Promise<ProjectRef | null> {
    const rows = (await this.sql`
      INSERT INTO entities (name, canonical_name, type, slug, visibility, owner_email, parent_id)
      VALUES (${project.name}, ${canonicalize(project.name)}, 'project', ${project.slug},
              ${project.visibility}, ${project.ownerEmail}, ${project.parentId})
      ON CONFLICT (type, canonical_name) DO NOTHING
      RETURNING id, name, slug, visibility, owner_email, parent_id
    `) as unknown as Row[];
    return toRef(rows[0]);
  }

  async parentIdOf(id: string): Promise<string | null> {
    const rows = (await this.sql`SELECT parent_id FROM entities WHERE id = ${id}`) as unknown as Row[];
    return (rows[0]?.parent_id as string | null) ?? null;
  }

  async update(id: string, changes: ProjectChanges): Promise<void> {
    await this.sql`
      UPDATE entities SET visibility = ${changes.visibility}, owner_email = ${changes.ownerEmail}, parent_id = ${changes.parentId}
      WHERE id = ${id}`;
  }

  async settingsChain(projectId: string): Promise<{ language: Language | null; criteria: unknown }[]> {
    const rows = (await this.sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, language, criteria, 0 AS depth FROM entities WHERE id = ${projectId}
        UNION ALL
        SELECT e.id, e.parent_id, e.language, e.criteria, c.depth + 1 FROM entities e JOIN chain c ON e.id = c.parent_id
      )
      SELECT language, criteria FROM chain ORDER BY depth
    `) as unknown as Row[];
    return rows.map((r) => ({ language: (r.language as Language | null) ?? null, criteria: r.criteria ?? null }));
  }

  async setLanguage(id: string, language: Language | null): Promise<void> {
    await this.sql`UPDATE entities SET language = ${language} WHERE id = ${id}`;
  }

  async setCriteria(id: string, criteria: ProjectCriteria | null): Promise<void> {
    const stored = criteria ? this.sql.json(criteria as unknown as JsonValue) : null;
    await this.sql`UPDATE entities SET criteria = ${stored} WHERE id = ${id}`;
  }

  async countEntries(projectId: string): Promise<number> {
    const [row] = (await this.sql`SELECT count(*)::int AS n FROM memos WHERE project_id = ${projectId}`) as unknown as Row[];
    return Number(row?.n ?? 0);
  }

  async countChildren(projectId: string): Promise<number> {
    const [row] = (await this.sql`SELECT count(*)::int AS n FROM entities WHERE parent_id = ${projectId}`) as unknown as Row[];
    return Number(row?.n ?? 0);
  }

  async remove(id: string): Promise<void> {
    await this.sql`DELETE FROM entities WHERE id = ${id}`;
  }

  async addMember(projectId: string, email: string): Promise<void> {
    await this.sql`INSERT INTO project_members (project_id, email) VALUES (${projectId}, ${email.toLowerCase()}) ON CONFLICT DO NOTHING`;
  }

  async removeMember(projectId: string, email: string): Promise<void> {
    await this.sql`DELETE FROM project_members WHERE project_id = ${projectId} AND email = ${email.toLowerCase()}`;
  }

  async listMembers(projectId: string): Promise<string[]> {
    const rows = (await this.sql`SELECT email FROM project_members WHERE project_id = ${projectId} ORDER BY email`) as unknown as Row[];
    return rows.map((r) => r.email as string);
  }
}

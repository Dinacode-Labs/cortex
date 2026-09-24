import { getSql } from "@cortex/database";
import { isAdmin } from "../identity/auth.js";
import { canManageProject, NotAManagerError, type ProjectRef } from "./projects.js";
import type { Row } from "../storage/map.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectLabel(entry: Row): string {
  return (entry.slug as string | null) ?? (entry.name as string | null) ?? "an entry with no project";
}

export interface PurgeResult {
  purged: string[];
}

export async function canManageEntryProject(email: string | null, project: Pick<ProjectRef, "slug"> | null): Promise<boolean> {
  if (!email) return false;
  if (project?.slug) return canManageProject(email, project.slug);
  return isAdmin(email);
}

export async function purgeEntries(ids: string[], byEmail: string | null): Promise<PurgeResult> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return { purged: [] };

  return getSql().begin(async (tx) => {
    const entries = (await tx`
      SELECT ce.id, ce.source_id, ce.project_id, ce.type, ce.source_type, ce.created_at, p.slug, p.name
        FROM context_entries ce
        LEFT JOIN entities p ON p.id = ce.project_id
       WHERE ce.id = ANY(${wanted}::uuid[])
         FOR UPDATE OF ce
    `) as unknown as Row[];
    if (entries.length === 0) return { purged: [] };

    if (!byEmail) throw new NotAManagerError(projectLabel(entries[0]!));
    const byProject = new Map<string, Row>();
    for (const e of entries) byProject.set((e.project_id as string | null) ?? "", e);
    for (const e of byProject.values()) {
      const project = e.project_id ? { slug: (e.slug as string | null) ?? null } : null;
      if (!(await canManageEntryProject(byEmail, project))) throw new NotAManagerError(projectLabel(e));
    }

    const found = entries.map((e) => e.id as string);
    const sourceIds = entries.map((e) => e.source_id as string | null).filter((s): s is string => !!s);
    const linkedEntities = (await tx`
      SELECT DISTINCT entity_id FROM context_entry_entities WHERE context_entry_id = ANY(${found}::uuid[])
    `) as unknown as Row[];

    await tx`
      UPDATE context_entries
         SET superseded_by = NULL, valid_to = NULL, validity = 'current',
             status = CASE WHEN status IN ('rejected', 'obsolete') THEN status ELSE 'pending_validation' END
       WHERE superseded_by = ANY(${found}::uuid[]) AND NOT (id = ANY(${found}::uuid[]))
    `;

    await tx`
      DELETE FROM relations WHERE source_id = ANY(${found}::uuid[]) OR target_id = ANY(${found}::uuid[])
    `;

    for (const e of entries) {
      await tx`
        INSERT INTO entry_purges (entry_id, project_id, entry_type, entry_source_type, entry_created_at, purged_by)
        VALUES (${e.id as string}, ${(e.project_id as string | null) ?? null}, ${e.type as string},
                ${e.source_type as string}, ${e.created_at as Date}, ${byEmail.toLowerCase()})
      `;
    }

    await tx`DELETE FROM context_entries WHERE id = ANY(${found}::uuid[])`;

    if (sourceIds.length) {
      await tx`
        DELETE FROM sources s
         WHERE s.id = ANY(${sourceIds}::uuid[])
           AND NOT EXISTS (SELECT 1 FROM context_entries ce WHERE ce.source_id = s.id)
      `;
    }

    const entityIds = linkedEntities.map((r) => r.entity_id as string);
    if (entityIds.length) {
      await tx`
        DELETE FROM entities en
         WHERE en.id = ANY(${entityIds}::uuid[])
           AND en.type NOT IN ('project', 'client')
           AND NOT EXISTS (SELECT 1 FROM context_entry_entities cee WHERE cee.entity_id = en.id)
           AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.source_id = en.id OR r.target_id = en.id)
           AND NOT EXISTS (SELECT 1 FROM context_entries ce WHERE ce.project_id = en.id OR ce.client_id = en.id)
           AND NOT EXISTS (SELECT 1 FROM entities child WHERE child.parent_id = en.id)
      `;
    }

    return { purged: found };
  });
}

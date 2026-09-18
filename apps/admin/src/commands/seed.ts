import { getSql } from "@cortex/database";
import type { ConfidenceLevel, ContextEntryType, SourceType } from "@cortex/shared";
import { createProject, registerUsageSink, relate, resolveEntity, saveContext } from "@cortex/core";

/**
 * Demo data: the fictional "Acme Portal" project belonging to the client "Acme Corp"
 * (section 15.1). Idempotent: it empties the knowledge tables and seeds again. It uses the
 * real pipeline (saveContext) to generate embeddings, entities and relations exactly as in
 * production.
 */

const PROJECT = "Acme Portal";
const CLIENT = "Acme Corp";

interface SeedEntry {
  content: string;
  type: ContextEntryType;
  confidence: ConfidenceLevel;
  sourceType: SourceType;
  sourceReference?: string;
}

const ENTRIES: SeedEntry[] = [
  {
    content:
      "Project architecture: Laravel on the backend, Vue on the frontend and PostgreSQL as the main database.",
    type: "architecture",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "We decided to keep the legacy billing module because the client depends on an external integration that cannot be migrated yet.",
    type: "decision",
    confidence: "high",
    sourceType: "manual",
    sourceReference: "Internal ADR #12",
  },
  {
    content:
      "The client Acme Corp does not allow public cloud services; the solution must be deployed on their own infrastructure.",
    type: "constraint",
    confidence: "verified",
    sourceType: "meeting_transcript",
    sourceReference: "Kickoff meeting 2026-01",
  },
  {
    content:
      "We decided to use OAuth with an external provider for authentication, because of the requirement to integrate the client's corporate accounts.",
    type: "decision",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "Past incident: PDF document generation in the billing module failed on large loads because of timeouts.",
    type: "incident",
    confidence: "high",
    sourceType: "jira_ticket",
    sourceReference: "TASK-98",
  },
  {
    content:
      "Technical debt: the legacy billing module has no automated tests and mixes business logic with the presentation layer.",
    type: "technical_debt",
    confidence: "medium",
    sourceType: "claude_code",
  },
  {
    content:
      "Risk: the billing module is sensitive; changing it carelessly can break the external integration with the client's ERP.",
    type: "risk",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "Convention: branches follow the feature/JIRA-id pattern and commits use Conventional Commits.",
    type: "convention",
    confidence: "high",
    sourceType: "notion_doc",
  },
  {
    content:
      "Integration with the client's ERP over a REST API to sync the invoices generated in the portal.",
    type: "integration_note",
    confidence: "medium",
    sourceType: "manual",
  },
  {
    content:
      "Billing is calculated by applying the Spanish 21% VAT, except for clients marked as exempt.",
    type: "business_rule",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "The Client Portal lets Acme's users look up and download their historical invoices.",
    type: "module_note",
    confidence: "medium",
    sourceType: "manual",
  },
  {
    content:
      "TASK-123 (Done): fixed the billing module's document generation bug by paginating the export. PR #456 merged.",
    type: "ticket_resolution",
    confidence: "verified",
    sourceType: "github_pr",
    sourceReference: "PR #456",
  },
];

export async function run(): Promise<void> {
  registerUsageSink();
  const sql = getSql();

  // Safeguard: the seed WIPES every table and reloads the Acme demo. So as not to destroy
  // real data (a project ingest, for instance), it requires confirmation.
  if (process.env.CORTEX_SEED_CONFIRM !== "1") {
    throw new Error(
      "db:seed EMPTIES every table and reloads the demo project 'Acme Portal'. " +
        "If you really do want to discard the current data, run it with " +
        "CORTEX_SEED_CONFIRM=1.",
    );
  }

  console.log("Emptying the knowledge tables...");
  await sql`TRUNCATE context_entry_entities, embeddings, relations, context_entries, sources, entities RESTART IDENTITY CASCADE`;

  const client = await resolveEntity(sql, CLIENT, "client");
  const project = await createProject(PROJECT); // with a slug: the database rejects projects without one (#135)
  await relate(sql, {
    sourceId: project.id,
    sourceType: "entity",
    targetId: client.id,
    targetType: "entity",
    relationType: "belongs_to",
    confidence: "verified",
  });

  console.log(`Seeding ${ENTRIES.length} entries for "${PROJECT}"...`);
  for (const e of ENTRIES) {
    const { entry, warnings } = await saveContext({
      content: e.content,
      project: PROJECT,
      type: e.type,
      confidence: e.confidence,
      sourceType: e.sourceType,
      sourceReference: e.sourceReference,
      createdBy: "seed",
    });
    const warn = warnings.length ? `  [${warnings.length} signal(s)]` : "";
    console.log(`  ✓ ${entry.type.padEnd(18)} ${entry.title.slice(0, 60)}${warn}`);
  }

  console.log("\nSeed finished.");
}



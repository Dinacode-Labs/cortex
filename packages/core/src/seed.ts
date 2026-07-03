import { closeSql, getSql } from "@cortex/database";
import type { ConfidenceLevel, ContextEntryType, SourceType } from "@cortex/shared";
import { relate, resolveEntity } from "./entities.js";
import { saveContext } from "./operations.js";

/**
 * Datos de demo: proyecto ficticio "Acme Portal" del cliente "Acme Corp"
 * (§15.1). Idempotente: vacía las tablas de conocimiento y vuelve a sembrar.
 * Usa el pipeline real (saveContext) para generar embeddings, entidades y
 * relaciones igual que en producción.
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
      "Arquitectura del proyecto: Laravel como backend, Vue en el frontend y PostgreSQL como base de datos principal.",
    type: "architecture",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "Se decidió mantener el módulo legacy de facturación porque el cliente depende de una integración externa que todavía no puede migrarse.",
    type: "decision",
    confidence: "high",
    sourceType: "manual",
    sourceReference: "ADR interno #12",
  },
  {
    content:
      "El cliente Acme Corp no permite usar servicios cloud públicos; la solución debe desplegarse en infraestructura propia.",
    type: "constraint",
    confidence: "verified",
    sourceType: "meeting_transcript",
    sourceReference: "Reunión kickoff 2026-01",
  },
  {
    content:
      "Se decidió usar OAuth con un proveedor externo para la autenticación, por el requisito de integrar las cuentas corporativas del cliente.",
    type: "decision",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "Incidencia previa: la generación de documentos PDF en el módulo de facturación fallaba con cargas grandes por timeouts.",
    type: "incident",
    confidence: "high",
    sourceType: "jira_ticket",
    sourceReference: "TASK-98",
  },
  {
    content:
      "Deuda técnica: el módulo legacy de facturación no tiene tests automatizados y mezcla lógica de negocio con la capa de presentación.",
    type: "technical_debt",
    confidence: "medium",
    sourceType: "claude_code",
  },
  {
    content:
      "Riesgo: el módulo de facturación es sensible; modificarlo sin cuidado puede romper la integración externa con el ERP del cliente.",
    type: "risk",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "Convención: las ramas siguen el patrón feature/JIRA-id y los commits usan Conventional Commits.",
    type: "convention",
    confidence: "high",
    sourceType: "notion_doc",
  },
  {
    content:
      "Integración con el ERP del cliente mediante API REST para sincronizar las facturas generadas en el portal.",
    type: "integration_note",
    confidence: "medium",
    sourceType: "manual",
  },
  {
    content:
      "La facturación se calcula aplicando el IVA español del 21% salvo para clientes marcados como exentos.",
    type: "business_rule",
    confidence: "high",
    sourceType: "manual",
  },
  {
    content:
      "El Portal Cliente permite a los usuarios de Acme consultar y descargar sus facturas históricas.",
    type: "module_note",
    confidence: "medium",
    sourceType: "manual",
  },
  {
    content:
      "TASK-123 (Done): corregido el error de generación de documentos del módulo de facturación añadiendo paginación al export. PR #456 fusionada.",
    type: "ticket_resolution",
    confidence: "verified",
    sourceType: "github_pr",
    sourceReference: "PR #456",
  },
];

async function seed(): Promise<void> {
  const sql = getSql();

  // Salvaguarda: el seed BORRA todas las tablas y recarga el demo Acme. Para no
  // destruir datos reales (p.ej. una ingesta de proyecto), exige confirmación.
  if (process.env.CORTEX_SEED_CONFIRM !== "1") {
    throw new Error(
      "db:seed VACÍA todas las tablas y recarga el proyecto demo 'Acme Portal'. " +
        "Si de verdad quieres descartar los datos actuales, ejecútalo con " +
        "CORTEX_SEED_CONFIRM=1.",
    );
  }

  console.log("Vaciando tablas de conocimiento...");
  await sql`TRUNCATE context_entry_entities, embeddings, relations, context_entries, sources, entities RESTART IDENTITY CASCADE`;

  const client = await resolveEntity(sql, CLIENT, "client");
  const project = await resolveEntity(sql, PROJECT, "project");
  await relate(sql, {
    sourceId: project.id,
    sourceType: "entity",
    targetId: client.id,
    targetType: "entity",
    relationType: "belongs_to",
    confidence: "verified",
  });

  console.log(`Sembrando ${ENTRIES.length} entradas para "${PROJECT}"...`);
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
    const warn = warnings.length ? `  [${warnings.length} señal(es)]` : "";
    console.log(`  ✓ ${entry.type.padEnd(18)} ${entry.title.slice(0, 60)}${warn}`);
  }

  console.log("\nSeed completado.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .catch((err) => {
      console.error("Error en el seed:", err);
      process.exitCode = 1;
    })
    .finally(() => closeSql());
}

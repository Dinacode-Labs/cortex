import { closeSql } from "@cortex/database";
import { runCaptureWorkflow } from "./workflows.js";

/**
 * Demo ejecutable del workflow de captura de Mastra (§20.4 / §21.2).
 * Uso: pnpm --filter @cortex/agents demo:capture "<texto>" ["<proyecto>"]
 * Requiere LLM (LLM_PROVIDER=openrouter) y Postgres sembrado.
 */

const content =
  process.argv[2] ??
  "Decidimos introducir una cola de mensajes con RabbitMQ para procesar las exportaciones de facturación de forma asíncrona y evitar timeouts.";
const project = process.argv[3] ?? "Acme Portal";

async function main() {
  console.log(`▶ captureContextWorkflow (Mastra)\n  proyecto: ${project}\n  texto: ${content}\n`);
  const out = await runCaptureWorkflow({ content, project, createdBy: "demo:capture" });
  console.log("Resultado del workflow:");
  console.log(`  paso classify + persist → entrada ${out.entryId}`);
  console.log(`  tipo: ${out.type}`);
  console.log(`  título: ${out.title}`);
  console.log(`  estado: ${out.status} · enriquecido por: ${out.enrichedBy}`);
  if (out.warnings.length) {
    console.log("  señales del loop de mejora:");
    for (const w of out.warnings) console.log(`   - ${w}`);
  }
}

main()
  .catch((e) => {
    console.error("Error en el workflow:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => closeSql());

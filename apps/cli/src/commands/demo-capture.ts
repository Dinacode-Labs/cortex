import { runCaptureWorkflow, wireLlm } from "@cortex/agents";

/**
 * Demo ejecutable del workflow de captura de Mastra (§20.4 / §21.2).
 * Uso: cortex demo-capture "<texto>" ["<proyecto>"]
 * Requiere LLM (LLM_PROVIDER=openrouter) y Postgres sembrado.
 */

export async function run(args: string[]): Promise<void> {
  wireLlm();
  const content =
    args[0] ??
    "Decidimos introducir una cola de mensajes con RabbitMQ para procesar las exportaciones de facturación de forma asíncrona y evitar timeouts.";
  const project = args[1] ?? "Acme Portal";
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



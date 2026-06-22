import { createStep, createWorkflow } from "@mastra/core/workflows";
import { saveContext } from "@cortex/core";
import { z } from "zod";
import { classifyEntry } from "./classify.js";

/**
 * Workflow de captura con Mastra (§20.4 captureContextWorkflow). Orquesta la
 * ingesta como pasos observables:
 *   1) classify  — el agente LLM propone tipo, título, resumen y entidades.
 *   2) persist    — @cortex/core persiste (embedding, entidades, loops de mejora).
 *
 * Separa "razonar" de "persistir" y deja traza por paso. Usa LLM para clasificar
 * y luego pasa los valores explícitos a saveContext (useClassifier:false) para no
 * volver a llamar al modelo.
 */

const captureInput = z.object({
  content: z.string().min(1),
  project: z.string().optional(),
  createdBy: z.string().optional(),
});

const classifyOutput = z.object({
  content: z.string(),
  project: z.string().optional(),
  createdBy: z.string().optional(),
  type: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  byLlm: z.boolean(),
});

const captureOutput = z.object({
  entryId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  enrichedBy: z.string(),
  warnings: z.array(z.string()),
});

const classifyStep = createStep({
  id: "classify",
  inputSchema: captureInput,
  outputSchema: classifyOutput,
  execute: async ({ inputData }) => {
    const c = await classifyEntry(inputData.content);
    return {
      ...inputData,
      type: c?.type,
      title: c?.title,
      summary: c?.summary,
      byLlm: c !== null,
    };
  },
});

const persistStep = createStep({
  id: "persist",
  inputSchema: classifyOutput,
  outputSchema: captureOutput,
  execute: async ({ inputData }) => {
    const { entry, warnings } = await saveContext(
      {
        content: inputData.content,
        project: inputData.project,
        createdBy: inputData.createdBy,
        type: inputData.type as never,
        title: inputData.title,
        summary: inputData.summary,
        metadata: inputData.byLlm ? { enrichedBy: "llm" } : undefined,
      },
      { useClassifier: false },
    );
    return {
      entryId: entry.id,
      type: entry.type,
      title: entry.title,
      status: entry.status,
      enrichedBy: (entry.metadata as { enrichedBy?: string }).enrichedBy ?? "heuristic",
      warnings: warnings.map((w) => w.message),
    };
  },
});

export const captureContextWorkflow = createWorkflow({
  id: "capture-context",
  inputSchema: captureInput,
  outputSchema: captureOutput,
})
  .then(classifyStep)
  .then(persistStep)
  .commit();

export type CaptureInput = z.infer<typeof captureInput>;
export type CaptureOutput = z.infer<typeof captureOutput>;

/** Helper para ejecutar el workflow y devolver su salida (o lanzar si falla). */
export async function runCaptureWorkflow(input: CaptureInput): Promise<CaptureOutput> {
  const run = await captureContextWorkflow.createRun();
  const result = await run.start({ inputData: input });
  if (result.status !== "success") {
    throw new Error(`Workflow capture-context terminó en estado: ${result.status}`);
  }
  return result.result;
}

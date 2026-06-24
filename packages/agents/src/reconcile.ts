import { setReconciler } from "@cortex/core";
import { runAgent } from "./mastra.js";

/**
 * Reconciliador LLM (merge + decisión) que core inyecta vía setReconciler. Lo usan tanto
 * la ingesta de sesiones como el servidor HTTP (capturas autenticadas) para hacer
 * ADD/UPDATE/SUPERSEDE/NOOP de verdad (no solo dedup determinista).
 */
async function mergeKnowledge(existing: string, incoming: string): Promise<string> {
  const prompt = `Entrada existente:\n"""\n${existing}\n"""\n\nNueva información sobre lo mismo:\n"""\n${incoming}\n"""\n\nFúndelas en UNA entrada consolidada.`;
  const merged = (await runAgent("merger", prompt, { maxOutputTokens: 700 })).trim();
  return merged || existing;
}

async function reconcile(existing: string, incoming: string): Promise<"noop" | "update" | "supersede"> {
  const prompt = `EXISTENTE:\n"""\n${existing}\n"""\n\nNUEVA:\n"""\n${incoming}\n"""\n\n¿Relación de la NUEVA respecto a la EXISTENTE?`;
  try {
    const raw = await runAgent("reconciler", prompt, { maxOutputTokens: 60 });
    const m = raw.match(/noop|update|supersede/i);
    return (m ? m[0].toLowerCase() : "update") as "noop" | "update" | "supersede";
  } catch {
    return "update"; // ante duda, fusionar (no invalidar a la ligera)
  }
}

let wired = false;
/** Inyecta el reconciliador LLM en core (idempotente). */
export function wireReconciler(): void {
  if (wired) return;
  setReconciler({ decide: reconcile, merge: mergeKnowledge });
  wired = true;
}

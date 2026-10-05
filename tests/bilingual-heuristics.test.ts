import { describe, it, expect } from "vitest";
import { classifyType, extractEntities, polarityContradicts, polarityTags } from "../packages/core/src/text";

/**
 * The no-model heuristics were written for a Spanish corpus, so an English memo got the catch-all
 * type, no module and no contradiction; a memo can be in either language (ADR-0080).
 */
describe("the heuristics read Spanish and English", () => {
  const SENTENCES: Record<string, { es: string; en: string }> = {
    constraint: { es: "No se permite desplegar fuera de la UE.", en: "Personal data cannot leave the EU." },
    incident: { es: "El viernes hubo una caída del servicio de pagos.", en: "Friday's outage took the payment service down." },
    technical_debt: { es: "El módulo de informes es código heredado.", en: "The reports module is legacy code nobody owns." },
    convention: { es: "La convención es una rama por ticket.", en: "Our standard is one branch per ticket." },
    risk: { es: "Hay riesgo de perder eventos si se llena la cola.", en: "Be careful with the cache: it is fragile under load." },
    architecture: { es: "La arquitectura separa lectura y escritura.", en: "The monolith is split into one layer per context." },
    integration_note: { es: "La integración con el banco va por webhook.", en: "The bank talks to us through a third-party gateway." },
    business_rule: { es: "Se factura a mes vencido.", en: "Each order is invoiced at the end of the month." },
    how_to: { es: "Cómo configurar el entorno local: copia el fichero de ejemplo.", en: "Steps to run it locally: copy the example file." },
    decision: { es: "Optamos por Postgres como único almacén.", en: "We went with Postgres as the only store." },
  };

  it("each type is recognised in both languages", () => {
    const misread = Object.entries(SENTENCES).flatMap(([type, byLanguage]) =>
      Object.entries(byLanguage)
        .map(([language, sentence]) => ({ language, sentence, expected: type, got: classifyType(sentence) }))
        .filter((r) => r.got !== r.expected),
    );
    expect(misread).toEqual([]);
  });

  it("the modules are found in English too", () => {
    const modules = extractEntities("The invoicing and authentication flows send notifications.")
      .filter((e) => e.type === "module")
      .map((e) => e.name)
      .sort();
    expect(modules).toEqual(["authentication", "invoicing", "notifications"]);
  });

  it("two English memos that pull opposite ways are flagged, as two Spanish ones are", () => {
    const contradicts = (a: string, b: string): boolean => polarityContradicts(polarityTags(a), polarityTags(b));
    expect({
      keepOrRemove: contradicts("We keep the old queue.", "We will remove the old queue."),
      onpremOrCloud: contradicts("Everything runs self-hosted on our own servers.", "Everything moves to a public cloud provider."),
      unrelated: contradicts("We keep the old queue.", "Everything runs self-hosted on our own servers."),
    }).toEqual({ keepOrRemove: true, onpremOrCloud: true, unrelated: false });
  });
});

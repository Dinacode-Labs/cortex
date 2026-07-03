import { describe, it, expect, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import {
  createProject,
  saveContext,
  searchContext,
  getContextPack,
  captureBatch,
  saveWithReconciliation,
  isNearDuplicate,
  listEntries,
} from "@cortex/core";

const RID = Date.now().toString(36); // sufijo único → aísla cada ejecución
afterAll(async () => {
  await closeSql();
});

describe("persistencia y búsqueda (BD real, embeddings local)", () => {
  it("guarda y recupera por búsqueda híbrida", async () => {
    const p = await createProject(`IT Search ${RID}`);
    await saveContext({ content: "Usamos pgvector pg16 para embeddings y búsqueda vectorial.", project: p.name, type: "decision" });
    const hits = await searchContext({ query: "pgvector embeddings vectorial", project: p.name, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /pgvector/.test(h.entry.content))).toBe(true);
  });

  it("context-pack hereda del proyecto padre (jerarquía)", async () => {
    const parent = await createProject(`IT Boluda ${RID}`);
    const child = await createProject(`IT Boluda API ${RID}`, { parentSlug: parent.slug! });
    await saveContext({ content: "Convención: todas las APIs usan OAuth2 corporativo.", project: parent.name, type: "convention", confidence: "high" });
    await saveContext({ content: "Decisión: el endpoint de facturas usa paginación cursor.", project: child.name, type: "decision", confidence: "high" });
    const pack = await getContextPack(child.name);
    const text = [...pack.decisions, ...pack.conventions].map((e) => e.content).join(" \n ");
    expect(text).toMatch(/OAuth2/); // heredado del padre
    expect(text).toMatch(/facturas/); // propio del subproyecto
  });
});

describe("captura por lotes + reconciliación (BD real)", () => {
  it("captureBatch es incremental por sourceReference y atribuye created_by", async () => {
    const p = await createProject(`IT Batch ${RID}`);
    const item = { content: "Contrato de mantenimiento 2026.", title: "Contrato 2026", sourceType: "document", sourceReference: "docs/contrato-2026" };
    const r1 = await captureBatch(p.name, [item], "dev@dinacode.com");
    expect(r1[0]!.action).toBe("added");
    const r2 = await captureBatch(p.name, [item], "dev@dinacode.com");
    expect(r2[0]!.action).toBe("existing"); // ya ingerido
    const entries = await listEntries({ project: p.name });
    expect(entries.some((e) => e.createdBy === "dev@dinacode.com")).toBe(true);
  });

  it("saveWithReconciliation hace NOOP de un near-duplicate idéntico", async () => {
    const p = await createProject(`IT Recon ${RID}`);
    const content = "El servicio de pagos usa Stripe en modo test para las pruebas.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const a = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "s1" } as never, opts);
    expect(a.action).toBe("add");
    expect(await isNearDuplicate(p.name, content)).toBe(true);
    const b = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "s2" } as never, opts);
    expect(b.action).toBe("noop"); // idéntico (≥ NOOP) y mismo source_type → NOOP
  });

  it("la resolución de proyecto es canónica: reconcilia aunque cambie la capitalización", async () => {
    const p = await createProject(`IT Canonical ${RID}`);
    const content = "La cola de trabajos usa Redis con reintentos exponenciales.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const a = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "c1" } as never, opts);
    expect(a.action).toBe("add");
    // Mismo proyecto con otra grafía: con el lookup por `name` exacto (bug) esto no
    // encontraba el proyecto y devolvía "add" (dedup silenciosamente inoperante).
    const b = await saveWithReconciliation({ content, project: p.name.toLowerCase(), type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "c2" } as never, opts);
    expect(b.action).toBe("noop");
    expect(await isNearDuplicate(p.name.toUpperCase(), content)).toBe(true);
  });
});

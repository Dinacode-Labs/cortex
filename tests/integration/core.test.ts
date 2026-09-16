import { describe, it, expect, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import {
  createProject,
  saveContext,
  searchContext,
  getContextPack,
  captureBatch,
  saveWithReconciliation,
  isNearDuplicate,
  listEntries,
  listAccessibleProjects,
  resolveEntity,
  relate,
  resolveEntities,
  setClassifier,
  setReconciler,
  lintProject,
  invalidateEntry,
  reclassifyProject,
  renderContextPack,
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
    const parent = await createProject(`IT Acme ${RID}`);
    const child = await createProject(`IT Acme API ${RID}`, { parentSlug: parent.slug! });
    await saveContext({ content: "Convención: todas las APIs usan OAuth2 corporativo.", project: parent.name, type: "convention", confidence: "high" });
    await saveContext({ content: "Decisión: el endpoint de facturas usa paginación cursor.", project: child.name, type: "decision", confidence: "high" });
    const pack = await getContextPack(child.name);
    const text = pack.sections.flatMap((s) => s.entries).map((e) => e.content).join(" \n ");
    expect(text).toMatch(/OAuth2/); // heredado del padre
    expect(text).toMatch(/facturas/); // propio del subproyecto
  });
});

describe("captura por lotes + reconciliación (BD real)", () => {
  it("captureBatch es incremental por sourceReference y atribuye created_by", async () => {
    const p = await createProject(`IT Batch ${RID}`);
    const item = { content: "Contrato de mantenimiento 2026.", title: "Contrato 2026", sourceType: "document", sourceReference: "docs/contrato-2026" };
    const r1 = await captureBatch(p.name, [item], "dev@example.com");
    expect(r1[0]!.action).toBe("added");
    const r2 = await captureBatch(p.name, [item], "dev@example.com");
    expect(r2[0]!.action).toBe("existing"); // ya ingerido
    const entries = await listEntries({ project: p.name });
    expect(entries.some((e) => e.createdBy === "dev@example.com")).toBe(true);
  });

  it("captureBatch clasifica con el LLM solo si CORTEX_CAPTURE_LLM=1", async () => {
    const p = await createProject(`IT CaptureLLM ${RID}`);
    let calls = 0;
    // Clasificador falso: fuerza un tipo que la heurística no daría para este texto.
    setClassifier(async () => {
      calls++;
      return { type: "business_rule", title: "Regla", summary: "s", entities: [] };
    });
    try {
      // Sin el flag → NO se llama al clasificador (tipo por heurística).
      delete process.env.CORTEX_CAPTURE_LLM;
      await captureBatch(p.name, [{ content: "Documento suelto sin tipo explícito, alfa.", sourceType: "document", sourceReference: "cap-off" }], "dev@example.com");
      expect(calls).toBe(0);

      // Con el flag → se clasifica con el LLM y el tipo lo pone el clasificador.
      process.env.CORTEX_CAPTURE_LLM = "1";
      await captureBatch(p.name, [{ content: "Documento suelto sin tipo explícito, beta.", sourceType: "document", sourceReference: "cap-on" }], "dev@example.com");
      expect(calls).toBe(1);

      const entries = await listEntries({ project: p.name });
      expect(entries.find((e) => e.sourceReference === "cap-on")?.type).toBe("business_rule");
      expect(entries.find((e) => e.sourceReference === "cap-off")?.type).not.toBe("business_rule");
    } finally {
      delete process.env.CORTEX_CAPTURE_LLM;
      setClassifier(null);
    }
  });

  /**
   * Dos decisiones vigentes que se contradicen: el pack entregaba las dos como buenas sin
   * decir nada, y el agente decidía a ciegas. No se invalida ninguna —cuál sobra no se puede
   * juzgar en automático sin arriesgarse a borrar la buena—, pero se avisa al lado de cada una.
   */
  it("el context-pack avisa de las decisiones que se contradicen, sin invalidar ninguna", async () => {
    const p = await createProject(`IT Conflicto ${RID}`);
    const opts = { useClassifier: false } as const;
    const vieja = await saveContext({ content: "Los reintentos usan backoff fijo de 30 segundos.", project: p.name, title: "Backoff fijo de 30s", type: "decision" }, opts);
    const nueva = await saveContext({ content: "Los reintentos usan backoff exponencial con tope de 60 segundos.", project: p.name, title: "Backoff exponencial con tope", type: "decision" }, opts);

    await relate(getSql(), {
      sourceId: nueva.entry.id,
      sourceType: "context_entry",
      targetId: vieja.entry.id,
      targetType: "context_entry",
      relationType: "contradicts",
    });

    const pack = await getContextPack(p.name);
    expect(pack.conflicts).toHaveLength(2); // una por cada lado: las dos reciben el aviso

    const texto = renderContextPack(pack);
    // Las DOS siguen en el pack: no se ha invalidado nada.
    expect(texto).toContain("Backoff fijo de 30s");
    expect(texto).toContain("Backoff exponencial con tope");
    // Y cada una avisa de la otra, con la dirección correcta.
    const lineas = texto.split("\n");
    const iVieja = lineas.findIndex((l) => l.includes("**Backoff fijo de 30s**"));
    const iNueva = lineas.findIndex((l) => l.includes("**Backoff exponencial con tope**"));
    expect(lineas.slice(iVieja, iVieja + 3).join(" ")).toContain('Conflicts with "Backoff exponencial con tope" (recorded later)');
    expect(lineas.slice(iNueva, iNueva + 3).join(" ")).toContain('Conflicts with "Backoff fijo de 30s" (recorded earlier)');
  });

  /**
   * El caso que de verdad ocurre: `maintain` no relaciona entradas entre sí, relaciona
   * ENTIDADES del grafo ("README" contradice "src/webhook.js"). El aviso tiene que bajar a las
   * entradas colgadas de cada entidad, que es lo que el agente está leyendo.
   */
  it("avisa también cuando la contradicción está entre entidades del grafo", async () => {
    const p = await createProject(`IT Conflicto Grafo ${RID}`);
    const opts = { useClassifier: false } as const;
    const entrada = await saveContext(
      { content: "El README dice que no hay idempotencia de webhooks.", project: p.name, title: "README sobre idempotencia", type: "decision" },
      opts,
    );
    const sql = getSql();
    const readme = await resolveEntity(sql, `README ${RID}`, "module");
    const webhook = await resolveEntity(sql, `src/webhook.js ${RID}`, "module");
    await sql`INSERT INTO context_entry_entities (context_entry_id, entity_id) VALUES (${entrada.entry.id}, ${readme.id}) ON CONFLICT DO NOTHING`;
    await relate(sql, { sourceId: readme.id, sourceType: "entity", targetId: webhook.id, targetType: "entity", relationType: "contradicts" });

    const texto = renderContextPack(await getContextPack(p.name));
    expect(texto).toContain("README sobre idempotencia");
    // No dice "esta entrada contradice X" —no es verdad—, dice que la zona está en disputa.
    expect(texto).toContain(`Touches "README ${RID}", which is recorded as contradicting "src/webhook.js ${RID}"`);

    // Y no se avisa a una entrada de que choca consigo misma: si está colgada de los DOS
    // lados de la disputa, no está en medio de la discusión, es la discusión.
    await sql`INSERT INTO context_entry_entities (context_entry_id, entity_id) VALUES (${entrada.entry.id}, ${webhook.id}) ON CONFLICT DO NOTHING`;
    const pack2 = await getContextPack(p.name);
    expect(pack2.conflicts.find((c) => c.entryId === entrada.entry.id)?.areas ?? []).toHaveLength(0);
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

  /**
   * El eco de dos vías: el agente guarda la decisión con la tool (`manual`) y, al cerrar la
   * sesión, la destilación la vuelve a guardar (`agent_session`) con otras palabras. Medido en
   * un proyecto real, ese par puntúa 0.86–0.88: ni llega al NOOP de 0.95 ni pasaba por las ramas
   * de abajo, que exigen el mismo origen. Se guardaba dos veces.
   */
  it("no repite conocimiento que ya está, aunque venga por otra vía", async () => {
    const p = await createProject(`IT Eco ${RID}`);
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    // El par está elegido para puntuar ~0.88 con los embeddings locales de los tests: en la
    // banda del eco real medido en producción (0.86–0.88), ni idéntico (≥0.95) ni distinto.
    const original = "El backoff de reintentos es exponencial con tope de 60 segundos y jitter.";
    const eco = "El backoff de reintentos es exponencial con tope de 60 segundos y jitter aleatorio para evitar sincronizacion.";

    const a = await saveWithReconciliation({ content: original, project: p.name, type: "decision", confidence: "low", sourceType: "manual", sourceReference: "tool" } as never, opts);
    expect(a.action).toBe("add");

    // Reconciliador de prueba: dice que es lo mismo, que es lo que haría el de verdad.
    setReconciler({ decide: async () => "noop", merge: async (x: string) => x });
    try {
      const b = await saveWithReconciliation({ content: eco, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "sesion" } as never, opts);
      expect(b.action).toBe("noop");
      expect(b.entryId).toBe(a.entryId); // apunta a la que ya estaba, no a una nueva
    } finally {
      setReconciler(null);
    }

    // Y sin reconciliador no se inventa nada: se guarda, como antes.
    const c = await saveWithReconciliation({ content: eco, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "sesion2" } as never, opts);
    expect(c.action).toBe("add");
  });

  it("un eco de la sesión NO se vuelve a guardar aunque la original sea manual", async () => {
    // El caso real: alguien captura algo a mano, un agente lo repite en su respuesta porque
    // la memoria se lo acaba de contar, y la captura de la sesión lo destila otra vez. Antes
    // se añadía, porque el NOOP exigía el mismo source_type y "manual" ≠ "agent_session".
    const p = await createProject(`IT Eco ${RID}`);
    const content = "Las exportaciones se procesan de forma asíncrona con reintentos y backoff exponencial.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;

    const manual = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "medium", sourceType: "manual" } as never, opts);
    expect(manual.action).toBe("add");

    const eco = await saveWithReconciliation(
      { content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "claude:x" } as never,
      opts,
    );
    expect(eco.action).toBe("noop");
    expect(eco.entryId).toBe(manual.entryId); // apunta a la original, no crea otra
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

describe("reclasificación diferida (maintain, BD real)", () => {
  it("reclassifyProject re-tipa con LLM solo las entradas heurísticas, no las ya-LLM", async () => {
    const p = await createProject(`IT Reclass ${RID}`);
    const opts = { detectImprovements: false, skipEmbedding: false } as const;
    // Entrada HEURÍSTICA (sin clasificador) → enrichedBy != 'llm'.
    await saveContext({ content: "Cerramos que el panel usará diálogos en cascada.", project: p.name, type: "incident", sourceReference: "rc-h" } as never, { ...opts, useClassifier: false });

    let calls = 0;
    setClassifier(async () => {
      calls++;
      return { type: "decision", title: "T", summary: "s", entities: [] };
    });
    try {
      // Entrada ya clasificada por el LLM → no debe reprocesarse.
      await saveContext({ content: "Otra cosa distinta clasificada por el LLM.", project: p.name, sourceReference: "rc-llm" } as never, { ...opts, useClassifier: true });
      const callsAfterSaves = calls; // 1 (solo el save con useClassifier:true)

      const rc = await reclassifyProject(p.name);
      expect(rc.scanned).toBe(1); // solo la heurística
      expect(rc.reclassified).toBe(1);
      expect(calls).toBe(callsAfterSaves + 1); // 1 llamada extra: solo la heurística

      const entries = await listEntries({ project: p.name });
      expect(entries.find((e) => e.sourceReference === "rc-h")?.type).toBe("decision"); // re-tipada
      expect(entries.find((e) => e.sourceReference === "rc-llm")?.type).toBe("decision"); // ya lo era, intacta
    } finally {
      setClassifier(null);
    }
  });
});

describe("lint solo mira entradas vigentes (BD real)", () => {
  it("no cuenta como duplicado un par que reconcile ya invalidó (histórica)", async () => {
    const p = await createProject(`IT Lint ${RID}`);
    const content = "El worker de exportaciones usa RabbitMQ con reintentos y DLQ.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    // Dos entradas idénticas y VIGENTES → el lint las ve como duplicado.
    const a = await saveContext({ content, project: p.name, type: "decision", sourceReference: "l1" } as never, opts);
    const b = await saveContext({ content, project: p.name, type: "decision", sourceReference: "l2" } as never, opts);
    const before = await lintProject(p.name);
    expect(before.duplicates.length).toBeGreaterThan(0);
    expect(before.totalEntries).toBe(2);

    // Invalidar una (como hace reconcile) → deja de ser vigente.
    await invalidateEntry(b.entry.id, a.entry.id);
    const after = await lintProject(p.name);
    expect(after.duplicates.length).toBe(0); // ya no cuenta la histórica
    expect(after.totalEntries).toBe(1); // solo la vigente
    expect(after.staleHistorical).toBeGreaterThan(0); // pero sí la reporta como histórica
  });
});

describe("integridad del grafo (UNIQUE parcial de aristas activas, D-5)", () => {
  it("relate es idempotente: dos veces la misma arista → una sola fila", async () => {
    const sql = getSql();
    // Entidades no-proyecto (evitan la exclusión de `project` en resolveEntities).
    const a = await resolveEntity(sql, `Vendor A ${RID}`, "vendor");
    const b = await resolveEntity(sql, `Vendor B ${RID}`, "vendor");

    await relate(sql, { sourceId: a.id, sourceType: "entity", targetId: b.id, targetType: "entity", relationType: "related_to" });
    // Segunda vez: con el UNIQUE parcial + ON CONFLICT DO NOTHING no lanza ni duplica.
    await relate(sql, { sourceId: a.id, sourceType: "entity", targetId: b.id, targetType: "entity", relationType: "related_to" });

    const rows = (await sql`
      SELECT count(*)::int AS n FROM relations
      WHERE source_id = ${a.id} AND target_id = ${b.id} AND relation_type = 'related_to' AND valid_to IS NULL
    `) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });

  it("resolveEntities fusiona entidades con aristas colisionantes sin lanzar (re-apuntado conflict-safe)", async () => {
    const sql = getSql();
    // Dos variantes del mismo nombre normalizado → se fusionan; un tercero como destino común.
    const canon = await resolveEntity(sql, `Acme Corp ${RID}`, "vendor");
    const dup = await resolveEntity(sql, `acme-corp ${RID}`, "vendor"); // misma norma → loser
    const target = await resolveEntity(sql, `Payments Svc ${RID}`, "service");

    // Ambas variantes tienen una arista al MISMO tercero con el MISMO tipo: tras re-apuntar
    // `source_id` del loser a la canónica, chocaría con la de la canónica (UNIQUE parcial).
    await relate(sql, { sourceId: canon.id, sourceType: "entity", targetId: target.id, targetType: "entity", relationType: "depends_on" });
    await relate(sql, { sourceId: dup.id, sourceType: "entity", targetId: target.id, targetType: "entity", relationType: "depends_on" });

    // No debe lanzar (sin el fix del punto 3, el UPDATE viola relations_active_unique → excepción).
    await expect(resolveEntities()).resolves.toBeDefined();

    // Sobrevive UNA sola de las dos variantes (cuál de ellas es la canónica lo decide el
    // desempate por enlaces/longitud/id, no el orden de filas: aquí ambas empatan, así que
    // se asserta la propiedad —quedan fusionadas— y no el ganador concreto).
    const survivors = (await sql`
      SELECT id FROM entities WHERE id IN (${canon.id}, ${dup.id})
    `) as unknown as { id: string }[];
    expect(survivors.length).toBe(1);
    // Y queda UNA sola arista activa superviviente→target (las colisionantes se dedupan).
    const edges = (await sql`
      SELECT count(*)::int AS n FROM relations
      WHERE source_id = ${survivors[0]!.id} AND target_id = ${target.id}
        AND relation_type = 'depends_on' AND valid_to IS NULL
    `) as unknown as { n: number }[];
    expect(edges[0]!.n).toBe(1);
  });

  it("resolveEntities NO fusiona homónimos de tipos distintos", async () => {
    const sql = getSql();
    // Mismo nombre normalizado, tipos distintos: son cosas diferentes (backlog #7).
    const vendor = await resolveEntity(sql, `Stripe ${RID}`, "vendor");
    const service = await resolveEntity(sql, `stripe ${RID}`, "service");
    expect(vendor.id).not.toBe(service.id);

    await resolveEntities();

    const rows = (await sql`
      SELECT id FROM entities WHERE id IN (${vendor.id}, ${service.id})
    `) as unknown as { id: string }[];
    expect(rows.length).toBe(2); // ambas siguen vivas
  });
});

describe("un proyecto se crea, no se extrae (BD real)", () => {
  /**
   * El clasificador ofrecía `project` entre los tipos de entidad, así que cualquier nombre propio
   * acababa en `entities` con `type='project'`: la misma fila que un proyecto de verdad, pero
   * sin slug ni dueño, y salía en `cortex link` y en la UI como si lo fuera. En una instalación
   * real, 26 fantasmas frente a 10 proyectos (#135).
   */
  it("una entidad `project` devuelta por el LLM no se convierte en proyecto", async () => {
    const p = await createProject(`IT Ghost ${RID}`);
    const ghost = `ghost-svc-${RID}`;
    setClassifier(async () => ({
      type: "decision",
      title: "T",
      summary: "s",
      entities: [
        { name: ghost, type: "project" },
        { name: `Stripe ${RID}`, type: "integration" },
      ],
    }));
    try {
      await saveContext(
        { content: `El servicio ${ghost} consume la API de pagos.`, project: p.name, sourceReference: "ghost" } as never,
        { detectImprovements: false, useClassifier: true },
      );
    } finally {
      setClassifier(null);
    }
    const sql = getSql();
    const rows = (await sql`SELECT type FROM entities WHERE canonical_name = ${ghost}`) as unknown as { type: string }[];
    expect(rows.map((r) => r.type)).toEqual([]); // ni como project ni recolocada en otro tipo
    const listed = await listAccessibleProjects(null);
    expect(listed.map((x) => x.name)).not.toContain(ghost);
    expect(listed.find((x) => x.id === p.id)?.slug).toBeTruthy(); // el de verdad sigue ahí, con slug
    // La entidad legítima de la misma respuesta sí entra.
    const ok = (await sql`SELECT 1 FROM entities WHERE canonical_name = ${`stripe ${RID}`} AND type = 'integration'`) as unknown as unknown[];
    expect(ok.length).toBe(1);
  });

  it("resolveEntity se niega a crear proyectos: eso es de createProject", async () => {
    await expect(resolveEntity(getSql(), `IT Refused ${RID}`, "project")).rejects.toThrow(/createProject/);
  });

  it("la base tampoco admite un proyecto sin slug, ni por SQL a mano", async () => {
    const sql = getSql();
    await expect(
      sql`INSERT INTO entities (name, canonical_name, type) VALUES (${`IT Raw ${RID}`}, ${`it raw ${RID}`}, 'project')`,
    ).rejects.toThrow(/entities_project_has_slug_check/);
  });
});

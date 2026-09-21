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
  listDecisions,
  checkProjectAccess,
  resolveEntity,
  relate,
  resolveEntities,
  setClassifier,
  setReconciler,
  autoCurate,
  lintProject,
  invalidateEntry,
  reclassifyProject,
  renderContextPack,
} from "@cortex/core";

const RID = Date.now().toString(36); // a unique suffix -> it isolates each run
afterAll(async () => {
  await closeSql();
});

describe("persistence and search (a real database, local embeddings)", () => {
  it("stores and retrieves through hybrid search", async () => {
    const p = await createProject(`IT Search ${RID}`);
    await saveContext({ content: "We use pgvector pg16 for embeddings and vector search.", project: p.name, type: "decision" });
    const hits = await searchContext({ query: "pgvector embeddings vectorial", project: p.name, limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /pgvector/.test(h.entry.content))).toBe(true);
  });

  it("the context pack inherits from the parent project (the hierarchy)", async () => {
    const parent = await createProject(`IT Acme ${RID}`);
    const child = await createProject(`IT Acme API ${RID}`, { parentSlug: parent.slug! });
    await saveContext({ content: "Convention: every API uses corporate OAuth2.", project: parent.name, type: "convention", confidence: "high" });
    await saveContext({ content: "Decision: the invoices endpoint uses cursor pagination.", project: child.name, type: "decision", confidence: "high" });
    const pack = await getContextPack(child.name);
    const text = pack.sections.flatMap((s) => s.entries).map((e) => e.content).join(" \n ");
    expect(text).toMatch(/OAuth2/); // inherited from the parent
    expect(text).toMatch(/invoices/); // the sub-project's own
  });
});

describe("batch capture plus reconciliation (a real database)", () => {
  it("captureBatch is incremental by sourceReference and attributes created_by", async () => {
    const p = await createProject(`IT Batch ${RID}`);
    const item = { content: "2026 maintenance contract.", title: "Contract 2026", sourceType: "document", sourceReference: "docs/contract-2026" };
    const r1 = await captureBatch(p.name, [item], "dev@example.com");
    expect(r1[0]!.action).toBe("added");
    const r2 = await captureBatch(p.name, [item], "dev@example.com");
    expect(r2[0]!.action).toBe("existing"); // already ingested
    const entries = await listEntries({ project: p.name });
    expect(entries.some((e) => e.createdBy === "dev@example.com")).toBe(true);
  });

  it("captureBatch classifies with the LLM only when CORTEX_CAPTURE_LLM=1", async () => {
    const p = await createProject(`IT CaptureLLM ${RID}`);
    let calls = 0;
    // A fake classifier: it forces a type the heuristic would not give for this text.
    setClassifier(async () => {
      calls++;
      return { type: "business_rule", title: "Rule", summary: "s", entities: [] };
    });
    try {
      // Without the flag -> the classifier is NOT called (a heuristic type).
      delete process.env.CORTEX_CAPTURE_LLM;
      await captureBatch(p.name, [{ content: "A loose document with no explicit type, alpha.", sourceType: "document", sourceReference: "cap-off" }], "dev@example.com");
      expect(calls).toBe(0);

      // With the flag -> it is classified with the LLM and the classifier sets the type.
      process.env.CORTEX_CAPTURE_LLM = "1";
      await captureBatch(p.name, [{ content: "A loose document with no explicit type, beta.", sourceType: "document", sourceReference: "cap-on" }], "dev@example.com");
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
   * Two current decisions that contradict each other: the pack handed both over as good
   * without saying anything, and the agent decided blind. Neither is invalidated -- which one
   * is redundant cannot be judged automatically without risking deleting the good one -- but a
   * warning goes next to each.
   */
  it("the context pack warns about decisions that contradict each other, without invalidating any", async () => {
    const p = await createProject(`IT Conflicto ${RID}`);
    const opts = { useClassifier: false } as const;
    const older = await saveContext({ content: "Retries use a fixed 30-second backoff.", project: p.name, title: "Fixed 30s backoff", type: "decision" }, opts);
    const newer = await saveContext({ content: "Retries use exponential backoff capped at 60 seconds.", project: p.name, title: "Capped exponential backoff", type: "decision" }, opts);

    await relate(getSql(), {
      sourceId: newer.entry.id,
      sourceType: "context_entry",
      targetId: older.entry.id,
      targetType: "context_entry",
      relationType: "contradicts",
    });

    const pack = await getContextPack(p.name);
    expect(pack.conflicts).toHaveLength(2); // one per side: both receive the warning

    const text = renderContextPack(pack);
    // BOTH are still in the pack: nothing was invalidated.
    expect(text).toContain("Fixed 30s backoff");
    expect(text).toContain("Capped exponential backoff");
    // And each one warns about the other, with the right direction.
    const lines = text.split("\n");
    const iOlder = lines.findIndex((l) => l.includes("**Fixed 30s backoff**"));
    const iNewer = lines.findIndex((l) => l.includes("**Capped exponential backoff**"));
    expect(lines.slice(iOlder, iOlder + 3).join(" ")).toContain('Conflicts with "Capped exponential backoff" (recorded later)');
    expect(lines.slice(iNewer, iNewer + 3).join(" ")).toContain('Conflicts with "Fixed 30s backoff" (recorded earlier)');
  });

  /**
   * The case that really happens: `maintain` does not relate entries to each other, it relates
   * graph ENTITIES ("README" contradicts "src/webhook.js"). The warning has to come down to the
   * entries hanging off each entity, which is what the agent is reading.
   */
  it("warns when the contradiction is between graph entities too", async () => {
    const p = await createProject(`IT Conflicto Grafo ${RID}`);
    const opts = { useClassifier: false } as const;
    const entry_ = await saveContext(
      { content: "The README says there is no webhook idempotence.", project: p.name, title: "README on idempotence", type: "decision" },
      opts,
    );
    const sql = getSql();
    const readme = await resolveEntity(sql, `README ${RID}`, "module");
    const webhook = await resolveEntity(sql, `src/webhook.js ${RID}`, "module");
    await sql`INSERT INTO context_entry_entities (context_entry_id, entity_id) VALUES (${entry_.entry.id}, ${readme.id}) ON CONFLICT DO NOTHING`;
    await relate(sql, { sourceId: readme.id, sourceType: "entity", targetId: webhook.id, targetType: "entity", relationType: "contradicts" });

    const text = renderContextPack(await getContextPack(p.name));
    expect(text).toContain("README on idempotence");
    // It does not say "this entry contradicts X" -- that is not true -- it says the area is disputed.
    expect(text).toContain(`Touches "README ${RID}", which is recorded as contradicting "src/webhook.js ${RID}"`);

    // And an entry is not warned that it clashes with itself: when it hangs off BOTH sides of
    // the dispute, it is not caught in the middle of the argument, it is the argument.
    await sql`INSERT INTO context_entry_entities (context_entry_id, entity_id) VALUES (${entry_.entry.id}, ${webhook.id}) ON CONFLICT DO NOTHING`;
    const pack2 = await getContextPack(p.name);
    expect(pack2.conflicts.find((c) => c.entryId === entry_.entry.id)?.areas ?? []).toHaveLength(0);
  });

  it("saveWithReconciliation NOOPs an identical near-duplicate", async () => {
    const p = await createProject(`IT Recon ${RID}`);
    const content = "The payments service uses Stripe in test mode for the test suite.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const a = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "s1" } as never, opts);
    expect(a.action).toBe("add");
    expect(await isNearDuplicate(p.name, content)).toBe(true);
    const b = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "s2" } as never, opts);
    expect(b.action).toBe("noop"); // identical (>= NOOP) and the same source_type -> NOOP
  });

  /**
   * The two-route echo: the agent stores the decision with the tool (`manual`) and, on closing
   * the session, distillation stores it again (`agent_session`) in different words. Measured in
   * a real project, that pair scores 0.86-0.88: it neither reaches the 0.95 NOOP nor went
   * through the branches below, which require the same origin. It was stored twice.
   */
  it("does not repeat knowledge that is already there, even arriving by another route", async () => {
    const p = await createProject(`IT Eco ${RID}`);
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    // The pair is chosen to score ~0.88 with the tests' local embeddings: in the band of the
    // real echo measured in production (0.86-0.88), neither identical (>=0.95) nor different.
    const original = "The retry backoff is exponential, capped at 60 seconds, with jitter.";
    const echo = "The retry backoff is exponential, capped at 60 seconds, with random jitter to avoid synchronisation.";

    const a = await saveWithReconciliation({ content: original, project: p.name, type: "decision", confidence: "low", sourceType: "manual", sourceReference: "tool" } as never, opts);
    expect(a.action).toBe("add");

    // A test reconciler: it says it is the same thing, which is what the real one would do.
    setReconciler({ decide: async () => "noop", merge: async (x: string) => x });
    try {
      const b = await saveWithReconciliation({ content: echo, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "session" } as never, opts);
      expect(b.action).toBe("noop");
      expect(b.entryId).toBe(a.entryId); // it points at the one already there, not at a newer one
    } finally {
      setReconciler(null);
    }

    // And with no reconciler nothing is invented: it gets stored, as before.
    const c = await saveWithReconciliation({ content: echo, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "session2" } as never, opts);
    expect(c.action).toBe("add");
  });

  it("a session echo is NOT stored again even when the original is manual", async () => {
    // The real case: somebody captures something by hand, an agent repeats it in its answer
    // because the memory just told it, and the session's capture distills it again. It used to
    // be added, because the NOOP required the same source_type and "manual" != "agent_session".
    const p = await createProject(`IT Eco ${RID}`);
    const content = "The exports are processed asynchronously with retries and exponential backoff.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;

    const manual = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "medium", sourceType: "manual" } as never, opts);
    expect(manual.action).toBe("add");

    const echo = await saveWithReconciliation(
      { content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "claude:x" } as never,
      opts,
    );
    expect(echo.action).toBe("noop");
    expect(echo.entryId).toBe(manual.entryId); // it points at the original, it does not create another
  });

  it("project resolution is canonical: it reconciles even when the casing changes", async () => {
    const p = await createProject(`IT Canonical ${RID}`);
    const content = "The job queue uses Redis with exponential retries.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const a = await saveWithReconciliation({ content, project: p.name, type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "c1" } as never, opts);
    expect(a.action).toBe("add");
    // The same project spelled differently: with the exact-`name` lookup (the bug) this did
    // not find the project and returned "add" (dedup silently inoperative).
    const b = await saveWithReconciliation({ content, project: p.name.toLowerCase(), type: "decision", confidence: "low", sourceType: "agent_session", sourceReference: "c2" } as never, opts);
    expect(b.action).toBe("noop");
    expect(await isNearDuplicate(p.name.toUpperCase(), content)).toBe(true);
  });
});

describe("deferred reclassification (maintain, a real database)", () => {
  it("reclassifyProject re-types with the LLM only the heuristic entries, not the already-LLM ones", async () => {
    const p = await createProject(`IT Reclass ${RID}`);
    const opts = { detectImprovements: false, skipEmbedding: false } as const;
    // A HEURISTIC entry (no classifier) -> enrichedBy != 'llm'.
    await saveContext({ content: "We settled that the panel will use cascading dialogs.", project: p.name, type: "incident", sourceReference: "rc-h" } as never, { ...opts, useClassifier: false });

    let calls = 0;
    setClassifier(async () => {
      calls++;
      return { type: "decision", title: "T", summary: "s", entities: [] };
    });
    try {
      // An entry the LLM already classified → it must not be reprocessed.
      await saveContext({ content: "Something else entirely, classified by the LLM.", project: p.name, sourceReference: "rc-llm" } as never, { ...opts, useClassifier: true });
      const callsAfterSaves = calls; // 1 (only the save with useClassifier:true)

      const rc = await reclassifyProject(p.name);
      expect(rc.scanned).toBe(1); // only the heuristic one
      expect(rc.reclassified).toBe(1);
      expect(calls).toBe(callsAfterSaves + 1); // 1 extra call: only the heuristic one

      const entries = await listEntries({ project: p.name });
      expect(entries.find((e) => e.sourceReference === "rc-h")?.type).toBe("decision"); // re-typed
      expect(entries.find((e) => e.sourceReference === "rc-llm")?.type).toBe("decision"); // it already was, left untouched
    } finally {
      setClassifier(null);
    }
  });
});

describe("confidence is earned by corroboration (a real database)", () => {
  /**
   * Every distilled entry reached medium confidence on the first `maintain` run without
   * anything having corroborated it. `autoCurate` promoted whatever had `updated_at` past
   * `created_at`, assuming only a merge moves it; minutes earlier in that same run,
   * reclassification had rewritten every heuristically typed entry -- which is all of them --
   * even when the classifier returned the type they already had. Nothing was ever corroborated,
   * the decay branch (which only looked at untouched entries) stopped firing, and the pack's
   * ordering by confidence degenerated into created_at DESC (ADR-0067).
   */
  it("promotes what reconciliation confirmed and leaves a lone entry low", async () => {
    const p = await createProject(`IT Corroborate ${RID}`);
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const auto = { project: p.name, type: "decision", confidence: "low", sourceType: "agent_session" } as const;
    const contentA = "The nightly export job retries three times with exponential backoff before giving up.";

    setReconciler({ decide: async () => "noop", merge: async (existing) => existing });
    let entryIdA: string;
    try {
      const a = await saveWithReconciliation({ ...auto, content: contentA, sourceReference: "cb-a" } as never, opts);
      expect(a.action).toBe("add");
      entryIdA = a.entryId;
      // The same knowledge arriving a second time: reconciliation decides there is nothing to
      // add, and THAT is the corroboration.
      const b = await saveWithReconciliation(
        { ...auto, content: contentA.replace("giving up", "it gives up"), sourceReference: "cb-b" } as never,
        opts,
      );
      expect(b.action).toBe("noop");
      expect(b.entryId).toBe(entryIdA);
    } finally {
      setReconciler(null);
    }

    const lone = await saveContext(
      { ...auto, content: "Invoice numbers run per fiscal year and the series never resets mid-year.", sourceReference: "cb-c" } as never,
      opts,
    );

    const beforeCuration = await listEntries({ project: p.name });
    expect(beforeCuration.find((e) => e.id === entryIdA)?.metadata.corroborations).toBe(1);
    expect(beforeCuration.find((e) => e.id === lone.entry.id)?.metadata.corroborations).toBeUndefined();

    await autoCurate();
    const afterCuration = await listEntries({ project: p.name });
    expect(afterCuration.find((e) => e.id === entryIdA)?.confidence).toBe("medium");
    expect(afterCuration.find((e) => e.id === lone.entry.id)?.confidence).toBe("low");

    // Reclassifying is not corroborating: a classifier that confirms the type must not write,
    // because the write is what auto-curation used to read as "this recurred".
    const touchedBefore = afterCuration.find((e) => e.id === lone.entry.id)!;
    setClassifier(async () => ({ type: "decision", title: "T", summary: "s", entities: [] }));
    try {
      const rc = await reclassifyProject(p.name);
      expect(rc.scanned).toBe(2);
      expect(rc.reclassified).toBe(0);
    } finally {
      setClassifier(null);
    }
    const touchedAfter = (await listEntries({ project: p.name })).find((e) => e.id === lone.entry.id)!;
    expect(touchedAfter.updatedAt.getTime()).toBe(touchedBefore.updatedAt.getTime());
    expect(touchedAfter.confidence).toBe("low");
  });

  /**
   * The decay branch had stopped firing altogether: it only looked at entries whose `updated_at`
   * had never moved, and by then everything had been written to at least once. An old entry that
   * was touched but never confirmed is exactly what has to leave search.
   */
  it("decays an old entry that was written to but never corroborated", async () => {
    const p = await createProject(`IT Decay ${RID}`);
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    const stale = await saveContext(
      {
        project: p.name,
        type: "decision",
        confidence: "low",
        sourceType: "agent_session",
        content: "The staging seed data is regenerated by hand every quarter.",
        sourceReference: "dk-a",
      } as never,
      opts,
    );
    // Born long ago and written to since (any UPDATE moves `updated_at` through the trigger):
    // the shape every reclassified entry had, and the one the old decay query could not see.
    await getSql()`UPDATE context_entries SET created_at = now() - interval '200 days' WHERE id = ${stale.entry.id}`;

    const curation = await autoCurate(30);
    expect(curation.decayed).toBeGreaterThanOrEqual(1);
    const after = (await listEntries({ project: p.name })).find((e) => e.id === stale.entry.id)!;
    expect(after.status).toBe("obsolete");
    expect(after.confidence).toBe("low");
  });
});

describe("lint only looks at current entries (a real database)", () => {
  it("does not count as a duplicate a pair reconcile already invalidated (historical)", async () => {
    const p = await createProject(`IT Lint ${RID}`);
    const content = "The exports worker uses RabbitMQ with retries and a DLQ.";
    const opts = { useClassifier: false, detectImprovements: false, skipEmbedding: false } as const;
    // Two identical, CURRENT entries -> the lint sees them as a duplicate.
    const a = await saveContext({ content, project: p.name, type: "decision", sourceReference: "l1" } as never, opts);
    const b = await saveContext({ content, project: p.name, type: "decision", sourceReference: "l2" } as never, opts);
    const before = await lintProject(p.name);
    expect(before.duplicates.length).toBeGreaterThan(0);
    expect(before.totalEntries).toBe(2);

    // Invalidate one (the way reconcile does) → it stops being current.
    await invalidateEntry(b.entry.id, a.entry.id);
    const after = await lintProject(p.name);
    expect(after.duplicates.length).toBe(0); // the historical one no longer counts
    expect(after.totalEntries).toBe(1); // only the current one
    expect(after.staleHistorical).toBeGreaterThan(0); // but it does report it as historical
  });
});

describe("graph integrity (the partial UNIQUE on active edges, D-5)", () => {
  it("relate is idempotent: the same edge twice → a single row", async () => {
    const sql = getSql();
    // Non-project entities (they avoid resolveEntities' `project` exclusion).
    const a = await resolveEntity(sql, `Vendor A ${RID}`, "vendor");
    const b = await resolveEntity(sql, `Vendor B ${RID}`, "vendor");

    await relate(sql, { sourceId: a.id, sourceType: "entity", targetId: b.id, targetType: "entity", relationType: "related_to" });
    // A second time: with the partial UNIQUE + ON CONFLICT DO NOTHING it neither throws nor duplicates.
    await relate(sql, { sourceId: a.id, sourceType: "entity", targetId: b.id, targetType: "entity", relationType: "related_to" });

    const rows = (await sql`
      SELECT count(*)::int AS n FROM relations
      WHERE source_id = ${a.id} AND target_id = ${b.id} AND relation_type = 'related_to' AND valid_to IS NULL
    `) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(1);
  });

  it("resolveEntities merges entities with colliding edges without throwing (conflict-safe re-pointing)", async () => {
    const sql = getSql();
    // Two variants of the same normalised name -> they merge; a third one as a common target.
    const canon = await resolveEntity(sql, `Acme Corp ${RID}`, "vendor");
    const dup = await resolveEntity(sql, `acme-corp ${RID}`, "vendor"); // the same normalisation → loser
    const target = await resolveEntity(sql, `Payments Svc ${RID}`, "service");

    // Both variants have an edge to the SAME third entity with the SAME type: after re-pointing
    // the loser's `source_id` to the canonical one, it would clash with the canonical one's
    // (the partial UNIQUE).
    await relate(sql, { sourceId: canon.id, sourceType: "entity", targetId: target.id, targetType: "entity", relationType: "depends_on" });
    await relate(sql, { sourceId: dup.id, sourceType: "entity", targetId: target.id, targetType: "entity", relationType: "depends_on" });

    // It must not throw (without point 3's fix, the UPDATE violates relations_active_unique -> an exception).
    await expect(resolveEntities()).resolves.toBeDefined();

    // Exactly ONE of the two variants survives (which one is canonical is decided by the
    // links/length/id tie-break, not by row order: here both tie, so the property is asserted
    // -- they end up merged -- rather than the specific winner).
    const survivors = (await sql`
      SELECT id FROM entities WHERE id IN (${canon.id}, ${dup.id})
    `) as unknown as { id: string }[];
    expect(survivors.length).toBe(1);
    // And ONE single active survivor→target edge is left (the colliding ones are deduped).
    const edges = (await sql`
      SELECT count(*)::int AS n FROM relations
      WHERE source_id = ${survivors[0]!.id} AND target_id = ${target.id}
        AND relation_type = 'depends_on' AND valid_to IS NULL
    `) as unknown as { n: number }[];
    expect(edges[0]!.n).toBe(1);
  });

  it("resolveEntities does NOT merge same-named entities of different types", async () => {
    const sql = getSql();
    // The same normalised name, different types: they are different things (backlog #7).
    const vendor = await resolveEntity(sql, `Stripe ${RID}`, "vendor");
    const service = await resolveEntity(sql, `stripe ${RID}`, "service");
    expect(vendor.id).not.toBe(service.id);

    await resolveEntities();

    const rows = (await sql`
      SELECT id FROM entities WHERE id IN (${vendor.id}, ${service.id})
    `) as unknown as { id: string }[];
    expect(rows.length).toBe(2); // both are still alive
  });
});

describe("a project is created, not extracted (a real database)", () => {
  /**
   * The classifier offered `project` among the entity types, so any proper noun ended up in
   * `entities` with `type='project'`: the same row as a real project, but with no slug and no
   * owner, and it showed up in `cortex link` and in the UI as though it were one. In a real
   * installation, 26 ghosts against 10 projects (#135).
   */
  it("a `project` entity returned by the LLM does not become a project", async () => {
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
        { content: `The ${ghost} service consumes the payments API.`, project: p.name, sourceReference: "ghost" } as never,
        { detectImprovements: false, useClassifier: true },
      );
    } finally {
      setClassifier(null);
    }
    const sql = getSql();
    const rows = (await sql`SELECT type FROM entities WHERE canonical_name = ${ghost}`) as unknown as { type: string }[];
    expect(rows.map((r) => r.type)).toEqual([]); // neither as a project nor moved to another type
    const listed = await listAccessibleProjects(null);
    expect(listed.map((x) => x.name)).not.toContain(ghost);
    expect(listed.find((x) => x.id === p.id)?.slug).toBeTruthy(); // the real one is still there, with a slug
    // The legitimate entity from the same response does get in.
    const ok = (await sql`SELECT 1 FROM entities WHERE canonical_name = ${`stripe ${RID}`} AND type = 'integration'`) as unknown as unknown[];
    expect(ok.length).toBe(1);
  });

  it("resolveEntity refuses to create projects: that is createProject's job", async () => {
    await expect(resolveEntity(getSql(), `IT Refused ${RID}`, "project")).rejects.toThrow(/createProject/);
  });

  it("the database does not accept a project with no slug either, not even through hand-written SQL", async () => {
    const sql = getSql();
    await expect(
      sql`INSERT INTO entities (name, canonical_name, type) VALUES (${`IT Raw ${RID}`}, ${`it raw ${RID}`}, 'project')`,
    ).rejects.toThrow(/entities_project_has_slug_check/);
  });
});

describe("the slug identifies the project when reading too (a real database)", () => {
  /**
   * The slug is the project's identity across the whole product (`cortex link`, `.cortex.json`,
   * `/p/<slug>`, the API), but reads resolved `project` by canonical name only, and
   * `canonicalize` leaves hyphens alone: writing with the slug hit the right project
   * (createProject looks at the slug) and reading with the same value said "not found" (#136).
   */
  it("pack, search, decisions and the guard accept the slug just like the name", async () => {
    const p = await createProject(`IT Slug Read ${RID}`);
    expect(p.slug).toBe(`it-slug-read-${RID}`);
    const opts = { detectImprovements: false, useClassifier: false } as const;
    // Writing with the slug already landed on the right project; it is pinned so it does not move.
    await saveContext({ content: "Decision: invoices are numbered by series and year.", project: p.slug!, type: "decision", title: "Invoice numbering" }, opts);
    expect((await listEntries({ project: p.name })).length).toBe(1);

    // …and now reading with the slug sees the same as reading with the name.
    const pack = await getContextPack(p.slug!);
    expect(pack.project).toBe(p.name);
    expect(pack.sections.flatMap((s) => s.entries).map((e) => e.title)).toContain("Invoice numbering");
    expect((await listDecisions(p.slug!)).length).toBe(1);
    expect((await listEntries({ project: p.slug! })).length).toBe(1);
    const hits = await searchContext({ query: "invoice numbering series", project: p.slug!, limit: 5 });
    expect(hits.map((h) => h.entry.title)).toContain("Invoice numbering");

    // The MCP's guard comes through here with `{ name }`: with the slug, with the exact name
    // and with a different casing of the name it has to answer the same.
    for (const ref of [p.slug!, p.name, p.name.toUpperCase()]) {
      const access = await checkProjectAccess(null, { name: ref });
      expect(access.status, ref).toBe("ok");
      if (access.status === "ok") expect(access.project.id).toBe(p.id);
    }
    expect((await checkProjectAccess(null, { name: `does-not-exist-${RID}` })).status).toBe("not_found");
  });

  it("when a name matches another project's slug, the slug wins: it is the identity", async () => {
    const real = await createProject(`IT Collision ${RID}`); // slug it-collision-<rid>
    const homonym = await createProject(`IT-Collision-${RID}-x`); // another project, another slug
    expect(homonym.id).not.toBe(real.id);
    const access = await checkProjectAccess(null, { name: real.slug! });
    expect(access.status === "ok" && access.project.id).toBe(real.id);
  });
});

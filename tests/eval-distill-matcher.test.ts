import { describe, it, expect } from "vitest";
import {
  matchDistillItems,
  summarizeDistillMatches,
  type DistillItem,
  type GoldWindow,
} from "../apps/admin/src/commands/eval-distill-match.js";

/**
 * The rule that decides whether a distilled window passed, exercised with no model.
 *
 * `eval-distill` needs an LLM and costs money and minutes, so the part that can be wrong in
 * silence -- the matching -- is measured here instead: a matcher that is too generous turns
 * every prompt change into an improvement, and one that is too strict makes a good prompt look
 * like a regression. Either way the numbers stop meaning anything and nobody notices, because
 * the only thing that is ever read is the total.
 *
 * The items and the keywords are Spanish because the fixture corpus is (see
 * `tests/fixtures/eval/README.md`): they are data, not prose.
 */
const item = (type: string, title: string, content: string): DistillItem => ({ type, title, content });

const gold = (
  expected: GoldWindow["expected"],
  forbidden: GoldWindow["forbidden"] = [],
  window = "w.txt",
): GoldWindow => ({ window, expected, forbidden });

describe("matchDistillItems", () => {
  /**
   * The corpus is Spanish and a model writes "Facturación" or "facturacion" depending on the
   * day. Comparing raw text would score the same run differently on two runs.
   */
  it("finds the keywords with no regard for accents or case", () => {
    const items = [item("decision", "Facturación cerrada, archivada aparte", "Se mueve a tabla PARTICIONADA por mes.")];
    const m = matchDistillItems(items, gold([{ type: "decision", must_mention: ["factura", "partición"] }]));
    expect(m.matched).toBe(1);
    expect(m.mistyped).toBe(0);
  });

  it("a missing keyword is a miss, even when the rest are there", () => {
    const items = [item("decision", "Facturación cerrada", "Se archiva aparte.")];
    const m = matchDistillItems(items, gold([{ type: "decision", must_mention: ["factura", "partición"] }]));
    expect(m.matched).toBe(0);
    expect(m.expectations[0]!.matchedItem).toBe(-1);
  });

  /**
   * Knowledge stored under the wrong type is not lost, it is unreachable: the search infers the
   * type from the question, so a decision filed as a note stops answering "what did we decide".
   * It must not count as a hit and it must not count as a miss either, or the prompt would be
   * blamed for something else.
   */
  it("tells a mistyped item apart from one that never came out", () => {
    const items = [item("module_note", "Identificador público con ULID", "Se cambia el autoincremental.")];
    const m = matchDistillItems(items, gold([{ type: "decision", must_mention: ["ulid"] }]));
    expect(m.matched).toBe(0);
    expect(m.mistyped).toBe(1);
    expect(m.expectations[0]!.mistypedItem).toBe(0);
  });

  /**
   * An item of the right type must answer for its own expectation. Matching in a single pass
   * would spend it as the mistyped evidence of the expectation listed first, reporting one miss
   * and one mistype where there are two clean hits.
   */
  it("does not spend an item of the right type as another expectation's mistype", () => {
    const items = [
      item("convention", "Clave de idempotencia obligatoria", "Todo trabajo entra con clave."),
      item("decision", "Idempotencia en encolado", "Se rechaza sin clave."),
    ];
    const m = matchDistillItems(
      items,
      gold([
        { type: "decision", must_mention: ["idempotencia"] },
        { type: "convention", must_mention: ["idempotencia"] },
      ]),
    );
    expect(m.matched).toBe(2);
    expect(m.mistyped).toBe(0);
  });

  /**
   * A window with three expectations must not pass by emitting one item that summarises the
   * whole session: that is precisely the distiller failure mode this eval exists to catch.
   */
  it("one item answers for one expectation at most", () => {
    const items = [item("decision", "Resumen de sesión", "Miniaturas en subida, ULID público y facturación particionada.")];
    const m = matchDistillItems(
      items,
      gold([
        { type: "decision", must_mention: ["miniatura"] },
        { type: "decision", must_mention: ["ulid"] },
        { type: "decision", must_mention: ["factura"] },
      ]),
    );
    expect(m.matched).toBe(1);
    expect(m.expected).toBe(3);
  });

  /**
   * The noise a window plants on purpose -- a hiccup local to the session, an abandoned idea --
   * is what forbidden sets are for: it is cheap to raise recall by keeping everything.
   */
  it("reports a forbidden keyword set kept in any item, once", () => {
    const items = [
      item("decision", "Webhook firmado por cuenta", "Con firma HMAC y reintentos."),
      item("technical_debt", "Kafka pendiente", "Se propuso meter Kafka entre proceso y envío."),
    ];
    const m = matchDistillItems(items, gold([{ type: "decision", must_mention: ["webhook"] }], [{ must_mention: ["kafka"] }]));
    expect(m.matched).toBe(1);
    expect(m.leaks).toEqual([{ keywords: ["kafka"], item: 1 }]);
    expect(m.forbidden).toBe(1);
  });

  /** `every` over an empty list is true, so an empty set would report a leak on any item. */
  it("a forbidden entry with no keywords is not a leak on everything", () => {
    const items = [item("decision", "Webhook firmado", "Con firma HMAC.")];
    const m = matchDistillItems(items, gold([], [{ must_mention: [] }]));
    expect(m.leaks).toEqual([]);
    expect(m.forbidden).toBe(0);
  });

  /**
   * The windows that must produce nothing (narration, an open discussion, acknowledgements)
   * are half the fixture. Nothing expected is not the same as everything matched.
   */
  it("a window with nothing expected matches nothing, whatever came out", () => {
    const items = [item("decision", "Logo con tres líneas", "Se propone un logo de tres líneas.")];
    const m = matchDistillItems(items, gold([], [{ must_mention: ["logo"] }]));
    expect(m.expected).toBe(0);
    expect(m.matched).toBe(0);
    expect(m.leaks).toHaveLength(1);
  });
});

describe("summarizeDistillMatches", () => {
  /**
   * Recall is aggregated over the expectations, not averaged over the windows: with four of the
   * eight windows expecting nothing, averaging per window would let a distiller that emits
   * nothing at all score 0.500 and look half right.
   */
  it("aggregates over the expectations, not over the windows", () => {
    const ulid = item("decision", "ULID", "Identificador público con ULID.");
    const matches = [
      matchDistillItems([ulid], gold([{ type: "decision", must_mention: ["ulid"] }], [], "a.txt")),
      matchDistillItems([], gold([], [], "b.txt")),
      matchDistillItems([], gold([{ type: "incident", must_mention: ["memoria"] }], [], "c.txt")),
    ];
    const s = summarizeDistillMatches(matches);
    expect(s.expected).toBe(2);
    expect(s.matched).toBe(1);
    expect(s.recall).toBeCloseTo(0.5, 5);
    expect(s.windowsWithoutItems).toBe(2);
    expect(s.itemsPerWindow).toBeCloseTo(1 / 3, 5);
  });

  it("the leak rate counts the forbidden sets, not the items that carry them", () => {
    const hiccups = [
      item("module_note", "Servidor MCP caído", "No conectaba el MCP."),
      item("technical_debt", "Test flaky", "Falla el test flaky."),
    ];
    const matches = [
      matchDistillItems(hiccups, gold([], [{ must_mention: ["mcp"] }, { must_mention: ["flaky"] }], "d.txt")),
      matchDistillItems([], gold([], [{ must_mention: ["logo"] }], "g.txt")),
    ];
    const s = summarizeDistillMatches(matches);
    expect(s.forbidden).toBe(3);
    expect(s.leaks).toBe(2);
    expect(s.leakRate).toBeCloseTo(2 / 3, 5);
  });

  it("with nothing to measure it does not invent a 1.000", () => {
    const s = summarizeDistillMatches([]);
    expect(s).toMatchObject({ windows: 0, recall: 0, leakRate: 0, itemsPerWindow: 0 });
  });
});

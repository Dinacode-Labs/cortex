import { describe, it, expect } from "vitest";
import { contextEntryType, keepsType, type ProjectCriteria } from "../packages/shared/src/index";
import { effectiveCriteria } from "../packages/core/src/projects/domain/project";
import { distillerPrompt } from "../packages/agents/src/agents/distiller/prompt";
import { parseDistilledItems } from "../packages/agents/src/agents/distiller/distill";

const criteria = (c: Partial<ProjectCriteria>): ProjectCriteria => ({ types: {}, keep: [], discard: [], ...c });

/**
 * A project narrows what its parent keeps and never widens it (ADR-0084): a client's rule that
 * one sub-project could switch off would not be the client's rule.
 */
describe("what a project keeps, given what its ancestors keep", () => {
  it("is everything when nobody in the chain says otherwise", () => {
    const effective = effectiveCriteria([null, null]);
    expect(contextEntryType.options.every((type) => keepsType(effective, type))).toBe(true);
    expect({ keep: effective.keep, discard: effective.discard }).toEqual({ keep: [], discard: [] });
  });

  it("does not bring back a type a parent discards, and lets the child discard more", () => {
    const parent = criteria({ types: { how_to: { keep: false } } });
    const child = criteria({ types: { how_to: { keep: true }, incident: { keep: false } } });
    const effective = effectiveCriteria([child, parent]);

    expect({ how_to: keepsType(effective, "how_to"), incident: keepsType(effective, "incident") }).toEqual({
      how_to: false,
      incident: false,
    });
  });

  it("reads the parent's guidance and lists first, and adds the child's", () => {
    const parent = criteria({ types: { decision: { keep: true, guidance: "public API" } }, keep: ["client deadlines"] });
    const child = criteria({
      types: { decision: { keep: true, guidance: "v2 only" } },
      keep: ["client deadlines", "pricing"],
    });
    const effective = effectiveCriteria([child, parent]);

    expect(effective.types.decision?.guidance).toBe("public API; v2 only");
    expect(effective.keep).toEqual(["client deadlines", "pricing"]);
  });
});

/**
 * The criteria only count if they reach the distiller, and the prompt alone is a request: the
 * model can still answer a type the project discards, so the parse drops it too.
 */
describe("the distiller follows the project's criteria", () => {
  const project = criteria({
    types: { how_to: { keep: false }, decision: { keep: true, guidance: "only those that change the public API" } },
    keep: ["deadlines agreed with the client"],
    discard: ["problems of a developer's local environment"],
  });

  it("is offered only the types the project keeps, with what counts as each one here", () => {
    const prompt = distillerPrompt("P", "a window", project);

    expect({
      offersHowTo: prompt.includes("- how_to:"),
      offersDecision: prompt.includes("- decision:"),
      guidance: prompt.includes("In this project: only those that change the public API."),
      keeps: prompt.includes("This project always keeps: deadlines agreed with the client."),
      discards: prompt.includes("This project never keeps: problems of a developer's local environment."),
    }).toEqual({ offersHowTo: false, offersDecision: true, guidance: true, keeps: true, discards: true });
  });

  it("drops what the model returns under a discarded type, including an unknown type when other is discarded", () => {
    const raw = JSON.stringify({
      items: [
        { type: "how_to", title: "Run it locally", content: "Copy the example env file." },
        { type: "decision", title: "Use ULIDs", content: "Public ids are ULIDs." },
        { type: "made_up", title: "Something", content: "Of a type that does not exist." },
      ],
    });
    const otherDiscarded = criteria({ types: { how_to: { keep: false }, other: { keep: false } } });

    expect(parseDistilledItems(raw).map((i) => i.type)).toEqual(["how_to", "decision", "other"]);
    expect(parseDistilledItems(raw, otherDiscarded).map((i) => i.type)).toEqual(["decision"]);
  });
});

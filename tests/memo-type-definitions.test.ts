import { describe, it, expect } from "vitest";
import { contextEntryType, MEMO_TYPE_DEFINITIONS } from "../packages/shared/src/index";
import { distillerPrompt } from "../packages/agents/src/agents/distiller/prompt";
import { classifierPrompt } from "../packages/agents/src/agents/classifier/prompt";

/**
 * The prompts listed the type names and defined none, so the model guessed what each one meant
 * and a project could not say which ones it keeps on any shared ground.
 */
describe("every memo type is defined, and the agents that pick a type are told the definitions", () => {
  it("each type has a definition, and nothing is defined that is not a type", () => {
    expect(Object.keys(MEMO_TYPE_DEFINITIONS).sort()).toEqual([...contextEntryType.options].sort());
  });

  it("each definition is short enough to repeat in every prompt", () => {
    const tooLong = Object.entries(MEMO_TYPE_DEFINITIONS).flatMap(([type, d]) =>
      [d.is, d.isNot].filter((text) => text.length > 120).map((text) => `${type}: ${text}`),
    );
    expect(tooLong).toEqual([]);
  });

  it("the distiller and the classifier get every definition", () => {
    const prompts = { distiller: distillerPrompt("P", "a window"), classifier: classifierPrompt("a memo") };
    const missing = Object.entries(prompts).flatMap(([agent, prompt]) =>
      contextEntryType.options
        .filter((type) => !prompt.includes(`- ${type}: ${MEMO_TYPE_DEFINITIONS[type].is}`))
        .map((type) => `${agent} lacks ${type}`),
    );
    expect(missing).toEqual([]);
  });
});

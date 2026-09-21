import { describe, it, expect } from "vitest";
import { isDerivedSummary, stripLeadingTitle, summarize } from "../packages/core/src/text.js";

/**
 * The summary is what the agent READS when a session opens: the pack renders `summary ??
 * content` under each title. It used to be the first 240 raw characters of the entry, so a
 * document chunk reached the agent as `…(`usedConfigurationId`) **Frontend** -` and a
 * distilled entry repeated almost all of itself.
 *
 * Every case here is one of those summaries as it was actually stored.
 */
describe("summarize", () => {
  it("a chunk that starts with a Markdown table becomes clean prose, with no pipes or markers", () => {
    const chunk = `## Configuration fields (3/7)

| Field | Type | Notes |
| --- | --- | --- |
| \`usedConfigurationId\` | string | **Frontend** only |

The frontend sends \`usedConfigurationId\` when the user picks a saved configuration.`;

    const summary = summarize(chunk);
    expect(summary).not.toMatch(/[|#`*_]/);
    expect(summary).toBe(
      "Configuration fields (3/7). Field · Type · Notes. usedConfigurationId · string · Frontend only. " +
        "The frontend sends usedConfigurationId when the user picks a saved configuration.",
    );
  });

  it("a long paragraph stops at a sentence boundary instead of at character 240", () => {
    const chunk = `## Retries

The queue retries three times. Beyond that the message lands in the **dead-letter queue**, where an operator looks at it by hand and replays it with \`cortex mem replay\`, which is the **deliberate friction** of [ADR-0031](./docs/decisions.md). Replaying blind duplicated a whole morning of invoices in production.`;

    const summary = summarize(chunk);
    expect(summary.endsWith(".")).toBe(true);
    expect(summary.endsWith("...")).toBe(false);
    expect(summary).toBe(
      "Retries. The queue retries three times. Beyond that the message lands in the dead-letter queue, " +
        "where an operator looks at it by hand and replays it with cortex mem replay, which is the " +
        "deliberate friction of ADR-0031.",
    );
  });

  it("the full stop it inserts between blocks does not land on top of a comma", () => {
    const chunk = `A list arrives in the middle of a sentence,

- the first item
- the second item`;
    // The case of what follows is left alone: capitalising would rewrite identifiers like
    // `usedConfigurationId`, and the stray comma is the part that reads as a defect.
    expect(summarize(chunk)).toBe("A list arrives in the middle of a sentence. the first item. the second item");
  });

  it("the HTML a Markdown file embeds goes out, but a generic type is not mistaken for a tag", () => {
    const chunk = '<img src="mark.svg" width="64" alt=""> The signature takes a <b>List&lt;String&gt;</b>, ' +
      "and the repository returns List<Invoice> for every page.";
    const summary = summarize(chunk);
    expect(summary).not.toMatch(/<(img|b)\b/);
    expect(summary).toMatch(/List<Invoice>/);
  });

  it("a text that already fits is handed back untouched", () => {
    const short = "RabbitMQ is used for the asynchronous billing exports.";
    expect(summarize(short)).toBe(short);
  });

  it("when the first sentence is longer than the budget it cuts at a space and says so", () => {
    const chunk =
      "The billing endpoint recomputes every line of the order from the catalogue that is current at " +
      "the moment of confirmation and does not trust the price the frontend sends, because the catalogue " +
      "may have changed between the moment the user opens the order form and the moment they submit it, " +
      "and the total the customer sees on confirming has to be the catalogue's and nobody else's. " +
      "It then posts the accounting entry.";

    const summary = summarize(chunk);
    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(243);
    // The last word survives whole: the cut lands on a space of the original text.
    const lastWord = summary.slice(0, -3).trim().split(" ").at(-1)!;
    expect(chunk).toMatch(new RegExp(`\\b${lastWord}\\b`));
    expect(summary).toMatch(/ the user\.\.\.$/);
  });

  it("the title is still stripped off afterwards when the content opens with a heading", () => {
    const content = `## RabbitMQ queue for the billing exports

RabbitMQ is introduced so the billing exports run asynchronously and stop timing out the synchronous endpoint.`;

    expect(stripLeadingTitle(summarize(content), "RabbitMQ queue for the billing exports")).toBe(
      "RabbitMQ is introduced so the billing exports run asynchronously and stop timing out the synchronous endpoint.",
    );
  });
});

/**
 * What `resummarize` and the deferred reclassification are allowed to overwrite. Getting this
 * wrong is silent and expensive in both directions: too strict and the summaries nobody is
 * going to re-ingest stay as they are; too loose and it rewrites a summary a person or the
 * model wrote, which is knowledge and not a cut of the content.
 */
describe("isDerivedSummary", () => {
  const content = "RabbitMQ queue.\n\nRabbitMQ is introduced so the billing exports run asynchronously.";
  const title = "RabbitMQ queue";

  it("a summary written by hand or by the model is not touched", () => {
    expect(isDerivedSummary("The exports stop blocking the synchronous endpoint.", content, title)).toBe(false);
  });

  it("an entry with no summary at all needs one", () => {
    expect(isDerivedSummary(null, content, title)).toBe(true);
    expect(isDerivedSummary("   ", content, title)).toBe(true);
  });

  it("the old heuristic's summary is recognised, with the title still on it and with it stripped", () => {
    expect(isDerivedSummary("RabbitMQ queue. RabbitMQ is introduced so the billing", content, title)).toBe(true);
    expect(isDerivedSummary("RabbitMQ is introduced so the billing exports", content, title)).toBe(true);
  });

  it("a summary the new heuristic produced is recognised too, so an LLM can still improve it", () => {
    expect(isDerivedSummary(summarize(content), content, title)).toBe(true);
  });

  it("a cut that ends in an ellipsis is still a cut", () => {
    const long = `# ${"a very long sentence with no full stops that forces a cut at a space ".repeat(6)}`;
    expect(isDerivedSummary(summarize(long), long, "a very long sentence")).toBe(true);
  });
});

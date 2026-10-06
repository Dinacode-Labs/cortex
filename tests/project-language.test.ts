import { describe, it, expect, afterEach } from "vitest";
import { effectiveLanguage, defaultLanguage } from "../packages/core/src/projects/domain/project";

/**
 * Getting the inheritance order wrong would make a sub-project write in the server's language
 * while its parent says otherwise (ADR-0081).
 */
describe("the language a project writes in", () => {
  it("is its own when it has one, whatever its ancestors say", () => {
    expect(effectiveLanguage(["en", "es"], "es")).toBe("en");
  });

  it("is the nearest ancestor's when it has none", () => {
    expect(effectiveLanguage([null, "en", "es"], "es")).toBe("en");
  });

  it("is the server's when nobody in the chain sets one", () => {
    expect(effectiveLanguage([null, null], "en")).toBe("en");
  });
});

describe("the server's default language", () => {
  const original = process.env.CORTEX_DEFAULT_LANGUAGE;
  afterEach(() => {
    if (original === undefined) delete process.env.CORTEX_DEFAULT_LANGUAGE;
    else process.env.CORTEX_DEFAULT_LANGUAGE = original;
  });

  it("is Spanish when nothing is set, so a server that sets nothing writes as it always did", () => {
    delete process.env.CORTEX_DEFAULT_LANGUAGE;
    expect(defaultLanguage()).toBe("es");
  });

  it("is the one configured, and a value it does not know falls back instead of breaking", () => {
    process.env.CORTEX_DEFAULT_LANGUAGE = "en";
    expect(defaultLanguage()).toBe("en");
    process.env.CORTEX_DEFAULT_LANGUAGE = "fr";
    expect(defaultLanguage()).toBe("es");
  });
});

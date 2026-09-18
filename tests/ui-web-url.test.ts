import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `cortex ui` authenticated against the right server and then opened the browser at
 * `http://localhost:8080`, because the web's address was a variable with a development default
 * instead of coming from the server itself.
 *
 * It is one of the most baffling failures there is: the whole flow says it is going fine --
 * session, ticket, "Opening the Cortex UI, already signed in" -- and the window that opens does
 * not exist.
 *
 * The server already publishes its `webUrl` in `/client-config`, which exists for exactly this.
 */
const src = readFileSync(resolve(import.meta.dirname, "../apps/cli/src/commands/ui.ts"), "utf8");

describe("cortex ui", () => {
  it("takes the web's address from what the server publishes", () => {
    expect(src).toContain("getClientConfig");
    expect(src).toMatch(/cfg\?\.webUrl/);
  });

  it("the development default is the LAST resort, not the first", () => {
    // Order: what the environment asks for > what the server says > localhost.
    const line = src.split("\n").find((l) => l.includes("localhost:8080"));
    expect(line, "the default must be in the same expression, at the end").toBeDefined();
    expect(line).toMatch(/CORTEX_WEB_URL.*cfg\?\.webUrl.*localhost:8080/);
  });
});

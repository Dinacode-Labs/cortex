import { createInterface } from "node:readline/promises";
import { DEFAULT_SERVER_URL, defaultServer, listCredentials, normalizeServer } from "@cortex/client";
import { getEnv, getBrandName } from "@cortex/shared";

/**
 * Which Cortex a command that does **not** work inside a repository talks to.
 *
 * The ones that do -- the hooks, `mem`, the MCP proxy, the connectors -- take it from the
 * folder's `.cortex.json` and never ask: that is ADR-0033's decision, and asking there would be
 * a mistake, because the folder always knows and the person may not remember.
 *
 * But `auth login`, `auth logout` and `ui` have no folder to draw on. Each of them used to
 * guess in its own way, and `auth login` guessed wrong: it went to the development server by
 * default **ignoring the one you already had configured**, so anyone with two sessions ended up
 * authenticating against the wrong one without noticing.
 *
 * The order is: what is asked for by hand wins, then the environment, then the obvious, and it
 * only asks when there genuinely is ambiguity and somebody is there to answer.
 */

export interface ServerChoiceOptions {
  /** The verb, so the question reads as a sentence: "sign in to", "open"... */
  verb: string;
  /** `auth login` may go to a server there is no session for yet. */
  allowUnknown?: boolean;
}

function argOf(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--")) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

/** `null` when it cannot be decided, and the reason has been explained. */
export async function resolveServer(args: string[], opts: ServerChoiceOptions): Promise<string | null> {
  const explicit = argOf(args, "server");
  if (explicit) return normalizeServer(explicit);

  // The environment beats what is stored: it is how a script says "this one and no other".
  const fromEnv = getEnv("CORTEX_SERVER_URL", "").trim();
  if (fromEnv) return normalizeServer(fromEnv);

  const sessions = listCredentials();
  if (sessions.length === 0) return opts.allowUnknown ? normalizeServer(DEFAULT_SERVER_URL) : null;
  if (sessions.length === 1) return normalizeServer(sessions[0]!.server);

  // Several sessions and nobody said which. Guessing here is what sent one client's knowledge
  // to another's server, so it either asks or it stops.
  if (!process.stdin.isTTY) {
    console.error(`There is more than one ${getBrandName()} configured. Say which one to ${opts.verb}:`);
    for (const c of sessions) {
      console.error(`  --server ${c.server}${normalizeServer(c.server) === defaultServer() ? "   (default)" : ""}`);
    }
    return null;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Which ${getBrandName()} do you want to ${opts.verb}?`);
    sessions.forEach((c, i) => {
      const mark = normalizeServer(c.server) === defaultServer() ? "  (default)" : "";
      console.log(`  ${i + 1}) ${c.server}${mark}  —  ${c.email}`);
    });
    const answer = (await rl.question(`Choose 1-${sessions.length} [1]: `)).trim();
    const n = answer === "" ? 1 : Number(answer);
    if (!Number.isInteger(n) || n < 1 || n > sessions.length) {
      console.error("That is not one of the options.");
      return null;
    }
    return normalizeServer(sessions[n - 1]!.server);
  } finally {
    rl.close();
  }
}

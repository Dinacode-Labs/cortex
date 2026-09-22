import postgres from "postgres";
import { getDatabaseUrl } from "./env.js";

export type Sql = postgres.Sql;

let client: Sql | undefined;

/**
 * Shared Postgres client (postgres.js). A lazy singleton, so importing this module opens no
 * connections until it is actually used.
 */
export function getSql(): Sql {
  if (!client) {
    client = postgres(getDatabaseUrl(), {
      // pgvector travels as text ('[1,2,3]'); we format/parse it by hand.
      transform: { undefined: null },
    });
  }
  return client;
}

export async function closeSql(): Promise<void> {
  if (client) {
    await client.end();
    client = undefined;
  }
}

export function toVectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Is the database answering? With a time cap, because a `/health` that hangs is worse than
 * one returning 503: the orchestrator restarts nothing and nobody finds out.
 */
export async function pingDatabase(timeoutMs = 2000): Promise<boolean> {
  try {
    await Promise.race([
      getSql()`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs).unref()),
    ]);
    return true;
  } catch {
    return false;
  }
}

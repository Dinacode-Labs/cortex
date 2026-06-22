import postgres from "postgres";
import { getDatabaseUrl } from "./env.js";

export type Sql = postgres.Sql;

let client: Sql | undefined;

/**
 * Cliente Postgres compartido (postgres.js). Singleton perezoso para que importar
 * este módulo no abra conexiones hasta que se use.
 */
export function getSql(): Sql {
  if (!client) {
    client = postgres(getDatabaseUrl(), {
      // pgvector viaja como texto ('[1,2,3]'); lo formateamos/parseamos a mano.
      transform: { undefined: null },
    });
  }
  return client;
}

/** Cierra la conexión. Útil en scripts puntuales (migrate, seed). */
export async function closeSql(): Promise<void> {
  if (client) {
    await client.end();
    client = undefined;
  }
}

/** Serializa un vector JS al literal que entiende pgvector: '[1,2,3]'. */
export function toVectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(",")}]`;
}

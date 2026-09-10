import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse as yamlParse } from "yaml";

/**
 * El despliegue no se puede levantar en CI, así que lo que se comprueba aquí son las cosas
 * que, si se rompen, se descubren en producción: que la base de datos no quede expuesta, que
 * los scripts sean POSIX válidos, que la imagen no corra como root y que el compose no pierda
 * un healthcheck. Todo esto se verificó además a mano levantando el stack completo.
 */
const root = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

interface Compose {
  services: Record<string, { ports?: string[]; healthcheck?: unknown; command?: string; networks?: string[]; image?: string }>;
  volumes: Record<string, unknown>;
}
const compose = yamlParse(read("deploy/docker-compose.yml")) as Compose;

describe("docker-compose de despliegue", () => {
  it("solo Caddy publica puertos: nada más se asoma a internet", () => {
    const conPuertos = Object.entries(compose.services)
      .filter(([, s]) => (s.ports?.length ?? 0) > 0)
      .map(([name]) => name);
    expect(conPuertos).toEqual(["caddy"]);
  });

  it("Postgres no publica puertos ni pierde su volumen", () => {
    expect(compose.services.postgres!.ports).toBeUndefined();
    expect(Object.keys(compose.volumes)).toContain("cortex-pgdata");
    expect(Object.keys(compose.volumes)).toContain("cortex-backups");
  });

  it("cada servicio de la aplicación tiene su healthcheck", () => {
    // server, web y mcp lo heredan del HEALTHCHECK de la imagen vía HEALTH_PORT; el worker,
    // que no escucha en ningún puerto, necesita el suyo por fichero de latido.
    expect(compose.services.worker!.healthcheck).toBeDefined();
    expect(compose.services.postgres!.healthcheck).toBeDefined();
    for (const s of ["server", "web", "mcp"]) {
      expect(JSON.stringify(compose.services[s]), s).toContain("HEALTH_PORT");
    }
  });

  it("migrate corre y sale, no se reinicia en bucle", () => {
    const migrate = compose.services.migrate as { restart?: string; command?: string };
    expect(migrate.restart).toBe("no");
    expect(migrate.command).toContain("migrate-cli.js");
  });

  it("los servicios ejecutan dist, nunca las fuentes con tsx", () => {
    for (const [name, s] of Object.entries(compose.services)) {
      if (!s.command) continue;
      expect(s.command, name).not.toContain("tsx");
      expect(s.command, name).toMatch(/dist\//);
    }
  });
});

describe("Caddyfile", () => {
  const caddy = read("deploy/Caddyfile");

  it("recorta el prefijo /api: el servidor no sabe que vive bajo él", () => {
    expect(caddy).toContain("handle_path /api/*");
  });

  it("el MCP va sin buffering, porque habla por streaming", () => {
    expect(caddy).toMatch(/handle \/mcp\*[\s\S]*flush_interval -1/);
  });

  it("pone HSTS y quita la cabecera Server", () => {
    expect(caddy).toContain("Strict-Transport-Security");
    expect(caddy).toContain("-Server");
  });
});

describe("Dockerfile", () => {
  const df = read("Dockerfile");

  it("es multi-etapa y la final no corre como root", () => {
    expect(df).toContain("AS deps");
    expect(df).toContain("AS build");
    expect(df).toContain("AS runtime");
    expect(df).toContain("USER node");
  });

  it("no usa `pnpm prune --prod`, que rompe los enlaces del workspace", () => {
    // Se llevaba por delante @cortex/shared y la imagen no arrancaba. Puede aparecer en un
    // comentario explicándolo; lo que no puede es ejecutarse.
    const ejecuta = df.split("\n").filter((l) => !l.trimStart().startsWith("#") && l.includes("pnpm prune"));
    expect(ejecuta).toEqual([]);
    expect(df).toContain("pnpm install --prod");
  });

  it("copia los ficheros de datos que las apps resuelven en ejecución", () => {
    expect(df).toContain("scripts/install.sh");
    expect(df).toContain("config/toolbelt.json");
  });

  it("tiene HEALTHCHECK con puerto configurable (la imagen sirve a tres servicios)", () => {
    expect(df).toContain("HEALTHCHECK");
    expect(df).toContain("HEALTH_PORT");
  });
});

describe("scripts de operación", () => {
  for (const s of ["deploy/restore.sh", "deploy/backup-now.sh"]) {
    it(`${s} es POSIX válido y ejecutable`, () => {
      execFileSync("sh", ["-n", resolve(root, s)]);
      expect(statSync(resolve(root, s)).mode & 0o111).toBeGreaterThan(0);
    });
  }

  it("restore.sh pide confirmación literal antes de destruir la base real", () => {
    const sh = read("deploy/restore.sh");
    expect(sh).toContain('"$ANSWER" = "restore"');
    // Y crea la extensión antes de cargar: sin ella, las columnas vector fallan.
    expect(sh).toMatch(/CREATE EXTENSION IF NOT EXISTS vector[\s\S]*Cargando el volcado/);
  });

  it("restore.sh no hace `source` del .env: hay valores con espacios sin comillas", () => {
    // La expresión cron del worker reventaba el script entero bajo `set -e`.
    expect(read("deploy/restore.sh")).not.toMatch(/^\s*\.\s+\.\/\.env/m);
  });
});

describe("deploy/.env.example", () => {
  const env = read("deploy/.env.example");

  it("no lleva valores de ninguna empresa concreta", () => {
    expect(env.toLowerCase()).not.toContain("dinacode.com");
    expect(env).toContain("example.com");
  });

  it("documenta lo que hay que fijar sí o sí", () => {
    for (const k of ["CORTEX_DOMAIN", "CORTEX_ACME_EMAIL", "POSTGRES_PASSWORD", "CORTEX_AUTH_DOMAIN", "EMBEDDINGS_DIM"]) {
      expect(env, k).toContain(k);
    }
  });
});

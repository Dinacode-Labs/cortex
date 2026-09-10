import { getClientConfig, readCortexLink, readCredentials, whoami } from "@cortex/client";
import { defaultCtx, detectAgents, getAdapter } from "../setup/index.js";
import type { SetupCtx } from "../setup/types.js";
import { CLI_VERSION, isOlderThan } from "../version.js";

/**
 * `cortex doctor` — por qué no funciona.
 *
 * Cortex tiene bastantes piezas (CLI, servidor, MCP, credenciales, vínculo del repo,
 * integración de cada agente) y cuando algo no va, lo caro es averiguar cuál. Esto las
 * comprueba todas de una vez y dice qué hacer con cada fallo.
 *
 * Sale con código 1 si algo crítico está roto, para poder usarlo en un script.
 */

type Nivel = "ok" | "aviso" | "error";

export interface Check {
  nombre: string;
  nivel: Nivel;
  detalle: string;
  /** Qué hacer. Solo cuando hay algo que hacer. */
  arreglo?: string;
}

const ICONO: Record<Nivel, string> = { ok: "✔", aviso: "!", error: "✗" };

async function ping(url: string, opts: { token?: string } = {}): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : undefined,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}


/**
 * Las comprobaciones, separadas de cómo se pintan. El contexto entra por parámetro porque
 * preguntarle a cada agente por su estado significa ejecutar SU binario, y en un test eso ni
 * se puede ni se quiere.
 */
export async function collectChecks(ctx: SetupCtx, cwd: string): Promise<Check[]> {
  const checks: Check[] = [];

  // --- Node -----------------------------------------------------------------
  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  checks.push({
    nombre: "Node",
    nivel: major >= 20 ? "ok" : "error",
    detalle: `v${process.versions.node}`,
    ...(major < 20 ? { arreglo: "Cortex needs Node 20 or newer." } : {}),
  });
  if (major < 22 || (major === 22 && minor < 5)) {
    checks.push({
      nombre: "Node (Hermes)",
      nivel: "aviso",
      detalle: "capturing Hermes sessions needs node:sqlite",
      arreglo: "Upgrade to Node 22.5 or newer if you use Hermes. Everything else works as is.",
    });
  }

  // --- Sesión y servidor ----------------------------------------------------
  const creds = readCredentials();
  if (!creds) {
    checks.push({ nombre: "Session", nivel: "error", detalle: "not signed in", arreglo: "cortex auth login" });
  } else {
    checks.push({ nombre: "Session", nivel: "ok", detalle: `${creds.email} on ${creds.server}` });

    const health = await ping(`${creds.server.replace(/\/$/, "")}/health`);
    checks.push({
      nombre: "Server",
      nivel: health.ok ? "ok" : "error",
      detalle: health.ok ? creds.server : `not responding (${health.error ?? `HTTP ${health.status}`})`,
      ...(health.ok ? {} : { arreglo: "Check the URL, or ask whoever runs the server." }),
    });

    if (health.ok) {
      const me = await whoami();
      checks.push({
        nombre: "Token",
        nivel: me.ok ? "ok" : "error",
        detalle: me.ok ? "valid" : `rejected (HTTP ${me.status})`,
        ...(me.ok ? {} : { arreglo: "cortex auth login" }),
      });

      const cfg = await getClientConfig(creds.server);
      if (cfg?.mcpUrl) {
        // El MCP sin token responde 401: eso YA demuestra que está vivo y pidiendo auth.
        const mcp = await ping(cfg.mcpUrl);
        const vivo = mcp.ok || mcp.status === 401 || mcp.status === 405 || mcp.status === 406;
        checks.push({
          nombre: "MCP",
          nivel: vivo ? "ok" : "error",
          detalle: vivo ? cfg.mcpUrl : `not responding (${mcp.error ?? `HTTP ${mcp.status}`})`,
          ...(vivo ? {} : { arreglo: "The MCP server is not running; tell whoever runs it." }),
        });
      } else {
        checks.push({ nombre: "MCP", nivel: "aviso", detalle: "the server does not publish its URL", arreglo: "Older server: the URL will be guessed from the port." });
      }

      const min = cfg?.minClientVersion;
      if (min && isOlderThan(CLI_VERSION, min)) {
        checks.push({ nombre: "CLI version", nivel: "aviso", detalle: `you have ${CLI_VERSION}, the server asks for ${min}`, arreglo: "cortex upgrade" });
      }
    }
  }

  // --- Este repo ------------------------------------------------------------
  const link = readCortexLink(cwd);
  if (!link) {
    checks.push({
      nombre: "This folder",
      nivel: "aviso",
      detalle: "not linked to any project",
      arreglo: 'cortex link <slug>  ·  or  cortex link --create "<Name>"',
    });
  } else if (link.ignore) {
    checks.push({ nombre: "This folder", nivel: "ok", detalle: "marked as ignored (a deliberate opt-out)" });
  } else {
    checks.push({ nombre: "This folder", nivel: "ok", detalle: `linked to "${link.slug ?? link.project}"` });
  }

  // --- Agentes --------------------------------------------------------------
  const detectados = detectAgents(ctx);
  if (detectados.length === 0) {
    checks.push({ nombre: "Agents", nivel: "aviso", detalle: "none found on this machine" });
  }
  for (const id of detectados) {
    const adapter = getAdapter(id);
    if (!adapter) continue;
    const st = await adapter.status(ctx);
    // Estar instalado no basta: un MCP que apunta al repo clonado «existe» y no funciona.
    const pendiente = st.details.some((d) => d.includes("ANTIGUO") || d.startsWith("⚠️"));
    const sano = st.installed && !pendiente;
    checks.push({
      nombre: `Agent ${id}`,
      nivel: sano ? "ok" : "aviso",
      detalle: st.details.join(" · ") || (st.installed ? "configured" : "not configured"),
      ...(sano ? {} : { arreglo: `cortex setup ${id}` }),
    });
  }

  return checks;
}

export async function run(args: string[] = []): Promise<void> {
  const cwd = process.env.INIT_CWD || process.cwd();
  const checks = await collectChecks(defaultCtx(), cwd);

  // --- Informe --------------------------------------------------------------
  const ancho = Math.max(...checks.map((c) => c.nombre.length));
  console.log("cortex doctor\n");
  for (const c of checks) {
    console.log(`  ${ICONO[c.nivel]} ${c.nombre.padEnd(ancho)}  ${c.detalle}`);
    if (c.arreglo) console.log(`    ${" ".repeat(ancho)}→ ${c.arreglo}`);
  }

  const errores = checks.filter((c) => c.nivel === "error").length;
  const avisos = checks.filter((c) => c.nivel === "aviso").length;
  console.log(
    errores
      ? `\n${errores} problem${errores > 1 ? "s" : ""} stopping Cortex from working${avisos ? `, and ${avisos} warning${avisos > 1 ? "s" : ""}` : ""}.`
      : avisos
        ? `\nEverything essential works (${avisos} warning${avisos > 1 ? "s" : ""}).`
        : "\nAll good.",
  );
  if (errores) process.exitCode = 1;
  if (args.includes("--verbose")) console.log(`\ncwd: ${cwd}`);
}

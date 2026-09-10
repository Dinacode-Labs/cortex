import { getClientConfig, readCortexLink, readCredentials, whoami } from "@cortex/client";
import { defaultCtx, detectAgents, getAdapter } from "../setup/index.js";
import type { SetupCtx } from "../setup/types.js";

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

/** Compara dos versiones semver sencillas (sin pre-releases). */
function menorQue(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
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
    ...(major < 20 ? { arreglo: "Cortex necesita Node ≥ 20." } : {}),
  });
  if (major < 22 || (major === 22 && minor < 5)) {
    checks.push({
      nombre: "Node (Hermes)",
      nivel: "aviso",
      detalle: "capturar sesiones de Hermes necesita node:sqlite",
      arreglo: "Actualiza a Node ≥ 22.5 si usas Hermes. El resto funciona igual.",
    });
  }

  // --- Sesión y servidor ----------------------------------------------------
  const creds = readCredentials();
  if (!creds) {
    checks.push({ nombre: "Sesión", nivel: "error", detalle: "no has iniciado sesión", arreglo: "cortex auth login" });
  } else {
    checks.push({ nombre: "Sesión", nivel: "ok", detalle: `${creds.email} en ${creds.server}` });

    const health = await ping(`${creds.server.replace(/\/$/, "")}/health`);
    checks.push({
      nombre: "Servidor",
      nivel: health.ok ? "ok" : "error",
      detalle: health.ok ? creds.server : `no responde (${health.error ?? `HTTP ${health.status}`})`,
      ...(health.ok ? {} : { arreglo: "Comprueba la URL o pregunta a quien opere el servidor." }),
    });

    if (health.ok) {
      const me = await whoami();
      checks.push({
        nombre: "Token",
        nivel: me.ok ? "ok" : "error",
        detalle: me.ok ? "válido" : `rechazado (HTTP ${me.status})`,
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
          detalle: vivo ? cfg.mcpUrl : `no responde (${mcp.error ?? `HTTP ${mcp.status}`})`,
          ...(vivo ? {} : { arreglo: "El servidor del MCP no está en marcha; avisa a infraestructura." }),
        });
      } else {
        checks.push({ nombre: "MCP", nivel: "aviso", detalle: "el servidor no dice su URL", arreglo: "Servidor antiguo: se deducirá del puerto." });
      }

      const min = cfg?.minClientVersion;
      const mine = process.env.CORTEX_CLI_VERSION || "0.0.0";
      if (min && mine !== "0.0.0" && menorQue(mine, min)) {
        checks.push({ nombre: "Versión del CLI", nivel: "aviso", detalle: `tienes ${mine}, el servidor pide ${min}`, arreglo: "cortex upgrade" });
      }
    }
  }

  // --- Este repo ------------------------------------------------------------
  const link = readCortexLink(cwd);
  if (!link) {
    checks.push({
      nombre: "Este repo",
      nivel: "aviso",
      detalle: "no está vinculado a ningún proyecto",
      arreglo: 'cortex link <slug>  ·  o  cortex link --create "<Nombre>"',
    });
  } else if (link.ignore) {
    checks.push({ nombre: "Este repo", nivel: "ok", detalle: "marcado como ignorado (opt-out deliberado)" });
  } else {
    checks.push({ nombre: "Este repo", nivel: "ok", detalle: `vinculado a "${link.slug ?? link.project}"` });
  }

  // --- Agentes --------------------------------------------------------------
  const detectados = detectAgents(ctx);
  if (detectados.length === 0) {
    checks.push({ nombre: "Agentes", nivel: "aviso", detalle: "no he detectado ninguno en este equipo" });
  }
  for (const id of detectados) {
    const adapter = getAdapter(id);
    if (!adapter) continue;
    const st = await adapter.status(ctx);
    // Estar instalado no basta: un MCP que apunta al repo clonado «existe» y no funciona.
    const pendiente = st.details.some((d) => d.includes("ANTIGUO") || d.startsWith("⚠️"));
    const sano = st.installed && !pendiente;
    checks.push({
      nombre: `Agente ${id}`,
      nivel: sano ? "ok" : "aviso",
      detalle: st.details.join(" · ") || (st.installed ? "configurado" : "sin configurar"),
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
    errores ? `\n${errores} problema(s) que impiden que funcione${avisos ? `, y ${avisos} aviso(s)` : ""}.` : avisos ? `\nTodo lo esencial funciona (${avisos} aviso(s)).` : "\nTodo en orden.",
  );
  if (errores) process.exitCode = 1;
  if (args.includes("--verbose")) console.log(`\ncwd: ${cwd}`);
}

#!/usr/bin/env node
// Pone la MISMA versión en todo el monorepo: raíz, paquetes, apps y los dos manifiestos del
// plugin. También cierra la sección [Unreleased] del CHANGELOG con la fecha de hoy.
//
//   node scripts/set-version.mjs 0.1.0
//
// La versión es única y en lockstep a propósito: con un solo artefacto publicable (el CLI) y
// una imagen que lleva todo lo demás dentro, versionar cada paquete por separado sería
// ceremonia sin beneficio, y nadie sabría qué versión tiene desplegada.
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Uso: node scripts/set-version.mjs <x.y.z>");
  process.exit(1);
}

const rel = (p) => resolve(ROOT, p);
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

const manifests = [
  "package.json",
  ...globSync("packages/*/package.json", { cwd: ROOT }),
  ...globSync("apps/*/package.json", { cwd: ROOT }),
];

for (const m of manifests) {
  const file = rel(m);
  const pkg = readJson(file);
  if (pkg.version === version) continue;
  pkg.version = version;
  writeJson(file, pkg);
  console.log(`  ${m} → ${version}`);
}

// El plugin lleva su propia versión, y el marketplace la repite: si se separan, Claude Code
// ofrece actualizar a una versión que no existe.
const pluginFile = rel("plugin/claude-code/.claude-plugin/plugin.json");
const plugin = readJson(pluginFile);
plugin.version = version;
writeJson(pluginFile, plugin);
console.log(`  plugin/claude-code → ${version}`);

const marketFile = rel(".claude-plugin/marketplace.json");
const market = readJson(marketFile);
market.metadata = { ...market.metadata, version };
for (const p of market.plugins) if (p.name === "cortex") p.version = version;
writeJson(marketFile, market);
console.log(`  .claude-plugin/marketplace.json → ${version}`);

// CHANGELOG: [Unreleased] pasa a ser la versión, con la fecha de hoy, y se abre una
// [Unreleased] vacía encima.
const changelogFile = rel("CHANGELOG.md");
let changelog = readFileSync(changelogFile, "utf8");
if (changelog.includes(`## [${version}]`)) {
  console.log(`  CHANGELOG.md ya tiene [${version}]`);
} else if (changelog.includes("## [Unreleased]")) {
  const today = new Date().toISOString().slice(0, 10);
  changelog = changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] — ${today}`);
  writeFileSync(changelogFile, changelog);
  console.log(`  CHANGELOG.md → [${version}] (${today})`);
} else {
  console.warn("  ⚠️  CHANGELOG.md no tiene sección [Unreleased]; revísalo a mano");
}

console.log(`\nListo. Ahora:\n  git commit -am "chore(release): v${version}"\n  git tag v${version} && git push origin main v${version}`);

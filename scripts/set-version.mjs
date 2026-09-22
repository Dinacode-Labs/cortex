#!/usr/bin/env node
// The version is single and in lockstep on purpose: with one publishable artefact (the CLI) and
// an image carrying everything else inside, versioning each package separately would be
// ceremony with no benefit, and nobody would know which version they had deployed.
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <x.y.z>");
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

// The plugin carries its own version, and the marketplace repeats it: if they drift apart,
// Claude Code offers an update to a version that does not exist.
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

const changelogFile = rel("CHANGELOG.md");
let changelog = readFileSync(changelogFile, "utf8");
if (changelog.includes(`## [${version}]`)) {
  console.log(`  CHANGELOG.md already has [${version}]`);
} else if (changelog.includes("## [Unreleased]")) {
  const today = new Date().toISOString().slice(0, 10);
  changelog = changelog.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] — ${today}`);
  writeFileSync(changelogFile, changelog);
  console.log(`  CHANGELOG.md → [${version}] (${today})`);
} else {
  console.warn("  ⚠️  CHANGELOG.md has no [Unreleased] section; check it by hand");
}

console.log(`\nDone. Now:\n  git commit -am "chore(release): v${version}"\n  git tag v${version} && git push origin main v${version}`);

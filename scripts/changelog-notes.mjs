#!/usr/bin/env node
// Imprime el bloque del CHANGELOG de una versión, para el cuerpo de la Release de GitHub.
//
//   node scripts/changelog-notes.mjs 0.1.0
//
// Las notas salen del CHANGELOG y no de los commits a propósito: los commits cuentan lo que
// se hizo, y las notas tienen que contar lo que cambia para quien lo usa.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("Uso: node scripts/changelog-notes.mjs <x.y.z>");
  process.exit(1);
}

const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md no tiene una sección para ${version}.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
if (end === -1) end = lines.length;

console.log(lines.slice(start + 1, end).join("\n").trim());

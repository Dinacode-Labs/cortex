#!/usr/bin/env node
// Prints a version's CHANGELOG block, for the body of the GitHub Release.
//
//   node scripts/changelog-notes.mjs 0.1.0
//
// The notes come from the CHANGELOG and not from the commits on purpose: commits say what was
// done, and release notes have to say what changes for whoever uses it.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("Usage: node scripts/changelog-notes.mjs <x.y.z>");
  process.exit(1);
}

const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
if (end === -1) end = lines.length;

console.log(lines.slice(start + 1, end).join("\n").trim());

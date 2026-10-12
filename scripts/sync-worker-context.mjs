#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "--check";
if (!["--check", "--write"].includes(mode) || process.argv.length > 3) throw new Error("Usage: node scripts/sync-worker-context.mjs [--check|--write]");
const packages = [["pi-subagents", "subagents"], ["pi-teams", "teams"], ["pi-swarm", "swarm"]];
for (const [name, extension] of packages) for (const suffix of ["mjs", "d.mts"]) {
	const source = readFileSync(join(root, "packages/shared", `worker-context.${suffix}`), "utf8");
	const destination = join(root, "packages", name, "extensions", extension, "context", `fork.${suffix}`);
	if (mode === "--write") { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, source); }
	else if (readFileSync(destination, "utf8") !== source) throw new Error(`${name} has stale bundled worker-context source; run --write`);
}
console.log(mode === "--write" ? "Bundled worker context synchronized in all three extensions." : "All three package-local worker context copies match their canonical source.");

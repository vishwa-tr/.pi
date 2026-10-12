import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createPiJiti, findPiPackage } from "./runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Pi discovers the shared skills through its compatibility directory", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-shared-discovery-"));
  try {
    const { loadSkills } = await import(pathToFileURL(join(findPiPackage(), "dist/index.js")).href);
    const result = loadSkills({ cwd: temporary, agentDir: join(root, "agent"), skillPaths: [], includeDefaults: true });
    assert.equal(result.skills.length, 39);
    assert.deepEqual(result.diagnostics, []);
    for (const skill of result.skills) {
      assert.ok(realpathSync(skill.filePath).startsWith(realpathSync(join(root, ".agents/skills")) + "/"));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Subagents and Teams resolve shared definitions through Pi's global directory", async () => {
  const jiti = await createPiJiti(import.meta.url);
  for (const [name, extension] of [["pi-subagents", "subagents"], ["pi-teams", "teams"]]) {
    const module = await jiti.import(join(root, "packages", name, "extensions", extension, "typedefs/discover.ts"));
    const { createLayout } = await jiti.import(join(root, "packages", name, "extensions", extension, "store/layout.ts"));
    const layout = createLayout(join(root, "missing-project"), { agentDir: join(root, "agent"), sessionId: "discovery-check" });
    const definitions = module.listTypeDefs(layout);
    assert.equal(definitions.length, 4, name);
    assert.ok(definitions.some((definition) => definition.name === "worker"), name);
    for (const definition of definitions) {
      const result = module.resolveFromSource(definition);
      assert.equal(result.ok, true, result.error);
    }
  }
});

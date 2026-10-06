import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dependencyRoot, findPiPackage, systemPromptText } from "./runtime.mjs";

function fakeSdk(path) {
  mkdirSync(join(path, "dist"), { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
  writeFileSync(join(path, "dist/index.js"), "");
  return path;
}

test("managed discovery follows current-version and an explicit SDK override", (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-sdk-discovery-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const install = join(home, ".pi/agent/install");
  for (const version of ["1.0.4", "1.0.5"]) fakeSdk(join(install, "releases", version, "node_modules/@earendil-works/pi-coding-agent"));
  writeFileSync(join(install, "current-version"), "1.0.4\n");
  assert.match(findPiPackage({ env: {}, home }), /1\.0\.4/);
  writeFileSync(join(install, "current-version"), "1.0.5\n");
  assert.match(findPiPackage({ env: {}, home }), /1\.0\.5/);
  const override = fakeSdk(join(home, "override"));
  assert.equal(findPiPackage({ env: { PI_SDK_DIR: override }, home }), override);
  writeFileSync(join(install, "current-version"), "../../unexpected");
  assert.throws(() => findPiPackage({ env: {}, home }), /Invalid managed Pi/);
});

test("dependency lookup handles both nested and hoisted packages", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-sdk-dependencies-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sdk = fakeSdk(join(directory, "node_modules/@earendil-works/pi-coding-agent"));
  const shared = join(directory, "node_modules/example");
  mkdirSync(shared); writeFileSync(join(shared, "package.json"), '{}');
  assert.equal(dependencyRoot("example", sdk), shared);
  const nested = join(sdk, "node_modules/example");
  mkdirSync(nested, { recursive: true }); writeFileSync(join(nested, "package.json"), '{}');
  assert.equal(dependencyRoot("example", sdk), nested);
});

test("provider fixtures retain structured system-prompt sections", () => {
  assert.equal(systemPromptText({ systemPrompt: "legacy" }), "legacy");
  assert.equal(systemPromptText({ messages: [{ role: "system", content: "base", sections: { identity: "worker", absent: null } }] }), "base\nworker");
});

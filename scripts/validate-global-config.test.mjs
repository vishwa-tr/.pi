import test from "node:test";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("configuration validation follows the portable skill layout and retains safeguards", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-config-validation-"));
  const fixture = join(temporary, "repository");
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--single-branch", root, fixture], {
      stdio: "pipe",
    });
    // Exercise the working validator against an isolated copy of committed resources.
    copyFileSync(join(root, "scripts/validate-global-config.mjs"), join(fixture, "scripts/validate-global-config.mjs"));

    await t.test("accepts the 28-skill layout with 30 evals and a separate runtime adapter", () => {
      const result = validate(fixture);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /28 global skills/);
    });
    await t.test("rejects removal of the independent-review requirement", () => {
      withChangedFile(fixture, "skills/github-issue-maintenance/SKILL.md",
        (text) => text.replace("Do not bypass review to publish", "Review is optional"), () => {
          assertFailure(fixture, "Do not bypass review to publish");
        });
    });
    await t.test("rejects removal of runtime retirement verification", () => {
      withChangedFile(fixture, "skills/github-issue-maintenance/references/pi-runtime.md",
        (text) => text.replace("absence alone is not proof", "absence is sufficient"), () => {
          assertFailure(fixture, "absence alone is not proof");
        });
    });
    await t.test("rejects a missing runtime adapter", () => {
      withChangedFile(fixture, "skills/github-issue-maintenance/references/pi-runtime.md",
        () => undefined, () => {
          assertFailure(fixture, "cannot read required guidance skills/github-issue-maintenance/references/pi-runtime.md");
        });
    });
    await t.test("rejects a missing authorization regression scenario", () => {
      withChangedFile(fixture, "skills/github-issue-maintenance/evals/evals.json", (text) => {
        const suite = JSON.parse(text);
        suite.evals = suite.evals.filter((item) => item.id !== 21);
        return JSON.stringify(suite);
      }, () => assertFailure(fixture, "github-issue-maintenance eval IDs"));
    });
    await t.test("rejects the old Plan skill name in runtime discovery", () => {
      withChangedFile(fixture, "configs/pi-agent/packages/pi-plan/extensions/plan/index.ts",
        (text) => text.replace('const PLAN_SKILL_NAME = "pi-plan-mode";', 'const PLAN_SKILL_NAME = "plan";'), () => {
          assertFailure(fixture, 'const PLAN_SKILL_NAME = "pi-plan-mode";');
        });
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

function assertFailure(fixture, message) {
  const result = validate(fixture);
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(message), result.output);
}

function validate(fixture) {
  const result = spawnSync(process.execPath, [join(fixture, "scripts/validate-global-config.mjs")], {
    cwd: fixture,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

function withChangedFile(fixture, relativePath, transform, check) {
  const path = join(fixture, relativePath);
  const original = readFileSync(path, "utf8");
  const changed = transform(original);
  assert.notEqual(changed, original, `mutation must change ${relativePath}`);
  try {
    if (changed === undefined) rmSync(path);
    else writeFileSync(path, changed);
    check();
  } finally {
    writeFileSync(path, original);
  }
}

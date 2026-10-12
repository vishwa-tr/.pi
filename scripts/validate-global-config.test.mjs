import test from "node:test";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("configuration validation follows the portable skill layout and retains safeguards", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-config-validation-"));
  const fixture = join(temporary, "repository");
  try {
    execFileSync("git", ["-c", "core.symlinks=true", "-c", "protocol.file.allow=always", "clone", "--quiet", "--no-hardlinks", "--single-branch", root, fixture], {
      stdio: "pipe",
    });
    execFileSync("git", ["-C", fixture, "config", "submodule..agents.url", join(root, ".agents")]);
    execFileSync("git", ["-C", fixture, "config", "core.symlinks", "true"]);
    execFileSync("git", ["-C", fixture, "-c", "protocol.file.allow=always", "submodule", "update", "--init"], { stdio: "pipe" });
    // Git can create dangling directory links as file links before submodules exist on Windows.
    if (process.platform === "win32") {
      for (const name of ["skills", "subagents", "procedures"]) {
        const path = join(fixture, "agent", name);
        rmSync(path);
        symlinkSync(`../.agents/${name}`, path, "dir");
      }
    }
    // Exercise the working validator against an isolated copy of committed resources.
    for (const path of ["scripts/validate-global-config.mjs", ".gitignore", "packages/pi-subagents/README.md"]) {
      copyFileSync(join(root, path), join(fixture, path));
    }
    // Model a clean clone without local records or misplaced container tooling.
    const removedPaths = execFileSync("git", ["-C", fixture, "ls-files", "-z", "--", "docs/", "containers/"], { encoding: "utf8" })
      .split("\0").filter(Boolean);
    if (removedPaths.length > 0) {
      execFileSync("git", ["-C", fixture, "rm", "--cached", "--", ...removedPaths], { stdio: "pipe" });
    }
    for (const directory of ["docs", "containers"]) {
      rmSync(join(fixture, directory), { recursive: true, force: true });
    }
    // Built-in MCP needs no shared custom-client guide or category directory.
    rmSync(join(fixture, ".agents", "mcp"), { recursive: true, force: true });

    await t.test("accepts the skill layout without local docs, containers, or legacy MCP resources", () => {
      assert.equal(existsSync(join(fixture, "docs")), false);
      assert.equal(existsSync(join(fixture, "containers")), false);
      assert.equal(existsSync(join(fixture, ".agents", "mcp")), false);
      const result = validate(fixture);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /39 global skills/);
    });
    await t.test("requires project-only documentation to remain ignored", () => {
      withChangedFile(fixture, ".gitignore",
        (text) => text.replace(/^\/docs\/\r?\n/gm, ""), () => {
          assertFailure(fixture, "expected ignored path is not covered: docs/probe.md");
          assertFailure(fixture, "expected ignored path is not covered: docs/agents/NOTES.md");
        });
    });
    await t.test("rejects forcibly tracked project-only documentation", () => {
      const probe = join(fixture, "docs", "probe.md");
      mkdirSync(dirname(probe), { recursive: true });
      writeFileSync(probe, "# Local investigation record\n");
      try {
        execFileSync("git", ["-C", fixture, "add", "--force", "--", "docs/probe.md"], { stdio: "pipe" });
        assertFailure(fixture, "project-only documentation must remain untracked: docs/probe.md");
      } finally {
        execFileSync("git", ["-C", fixture, "rm", "--cached", "--", "docs/probe.md"], { stdio: "pipe" });
        rmSync(join(fixture, "docs"), { recursive: true, force: true });
      }
    });
    await t.test("requires built-in MCP credentials to remain ignored in both layouts", () => {
      withChangedFile(fixture, ".gitignore",
        (text) => text.replace(/^\/(?:agent\/)?mcp-auth\.json\*\r?\n/gm, ""), () => {
          assertFailure(fixture, "expected ignored path is not covered: mcp-auth.json");
          assertFailure(fixture, "expected ignored path is not covered: agent/mcp-auth.json");
        });
    });
    await t.test("requires rotated MCP logs to remain ignored in both layouts", () => {
      withChangedFile(fixture, ".gitignore",
        (text) => text.replace(/^\/(?:agent\/)?mcp\.log\*\r?\n/gm, ""), () => {
          assertFailure(fixture, "expected ignored path is not covered: mcp.log.1");
          assertFailure(fixture, "expected ignored path is not covered: agent/mcp.log.1");
        });
    });
    await t.test("requires maintained package documentation for await outcomes", () => {
      withChangedFile(fixture, "packages/pi-subagents/README.md",
        (text) => text.replaceAll("outcomes", "results"), () => {
          assertFailure(fixture, "Pi Subagents package documentation is missing: outcomes");
        });
    });
    await t.test("rejects removal of the independent-review requirement", () => {
      withChangedFile(fixture, ".agents/skills/github-issue-maintenance/SKILL.md",
        (text) => text.replace("Do not bypass review to publish", "Review is optional"), () => {
          assertFailure(fixture, "Do not bypass review to publish");
        });
    });
    await t.test("rejects removal of runtime retirement verification", () => {
      withChangedFile(fixture, ".agents/skills/github-issue-maintenance/references/pi-runtime.md",
        (text) => text.replace("absence alone is not proof", "absence is sufficient"), () => {
          assertFailure(fixture, "absence alone is not proof");
        });
    });
    await t.test("rejects a missing runtime adapter", () => {
      withChangedFile(fixture, ".agents/skills/github-issue-maintenance/references/pi-runtime.md",
        () => undefined, () => {
          assertFailure(fixture, "cannot read required guidance .agents/skills/github-issue-maintenance/references/pi-runtime.md");
        });
    });
    await t.test("rejects a missing authorization regression scenario", () => {
      withChangedFile(fixture, ".agents/skills/github-issue-maintenance/evals/evals.json", (text) => {
        const suite = JSON.parse(text);
        suite.evals = suite.evals.filter((item) => item.id !== 21);
        return JSON.stringify(suite);
      }, () => assertFailure(fixture, "github-issue-maintenance eval IDs"));
    });
    await t.test("rejects the old Plan skill name in runtime discovery", () => {
      withChangedFile(fixture, "packages/pi-plan/extensions/plan/index.ts",
        (text) => text.replace('const PLAN_SKILL_NAME = "pi-plan-mode";', 'const PLAN_SKILL_NAME = "plan";'), () => {
          assertFailure(fixture, 'const PLAN_SKILL_NAME = "pi-plan-mode";');
        });
    });
    await t.test("rejects a submodule configured for the wrong repository", () => {
      withChangedFile(fixture, ".gitmodules",
        (text) => text.replace("voidverse-xyz/.agents.git", "example/wrong.git"), () => {
          assertFailure(fixture, ".agents submodule configuration must use the shared repository");
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

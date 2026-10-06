#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notes = [];

const EXPECTED_PACKAGE_COUNT = 32;
const EXPECTED_SKILL_COUNT = 28;
const AGENT_PACKAGE_PREFIX = "./configs/pi-agent/packages/";

function fail(message) {
  failures.push(message);
}

function rel(path) {
  return path.slice(root.length + 1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${rel(path)} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function git(args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validatePackageList(settings, settingsRelPath, baseDir, packagePrefix) {
  if (!Array.isArray(settings.packages)) {
    fail(`${settingsRelPath} packages must be an array`);
    return;
  }
  if (settings.packages.length !== EXPECTED_PACKAGE_COUNT) {
    fail(`${settingsRelPath} must enable ${EXPECTED_PACKAGE_COUNT} reviewed packages; found ${settings.packages.length}`);
  }
  if (new Set(settings.packages).size !== settings.packages.length) {
    fail(`${settingsRelPath} contains duplicate package entries`);
  }
  for (const packagePath of settings.packages) {
    if (typeof packagePath !== "string") {
      fail(`${settingsRelPath} package entry is not a string: ${JSON.stringify(packagePath)}`);
      continue;
    }
    if (isAbsolute(packagePath) || !packagePath.startsWith(packagePrefix)) {
      fail(`${settingsRelPath} package path is not portable and agent-dir-relative: ${packagePath}`);
      continue;
    }
    if (packagePath.includes("_archive") || packagePath.toLowerCase().includes("/archive/")) {
      fail(`${settingsRelPath} active package points into an archive: ${packagePath}`);
    }
    const absolutePackage = resolve(baseDir, packagePath);
    let stat;
    try {
      stat = lstatSync(absolutePackage);
    } catch {
      fail(`${settingsRelPath} configured package does not exist: ${packagePath}`);
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`${settingsRelPath} configured package is not an ordinary directory: ${packagePath}`);
      continue;
    }
    const manifest = readJson(join(absolutePackage, "package.json"));
    if (!manifest) continue;
    if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("pi-package")) {
      fail(`${packagePath}/package.json is missing the pi-package keyword`);
    }
    for (const resourceType of ["extensions", "skills", "prompts", "themes"]) {
      for (const resourcePath of manifest.pi?.[resourceType] ?? []) {
        try {
          lstatSync(resolve(absolutePackage, resourcePath));
        } catch {
          fail(`${packagePath} declares missing ${resourceType} resource: ${resourcePath}`);
        }
      }
    }
  }
}

function validateSettingsFile({ relativePath, baseDir, allowedKeys, optionalKeys = [], packagePrefix, expectedSkills }) {
  const settings = readJson(join(root, relativePath));
  if (!settings) return undefined;
  const keys = Object.keys(settings).sort();
  const acceptedKeys = new Set([...allowedKeys, ...optionalKeys]);
  const unknownKeys = keys.filter((key) => !acceptedKeys.has(key));
  const missingKeys = allowedKeys.filter((key) => !Object.hasOwn(settings, key));
  if (unknownKeys.length > 0) {
    fail(`${relativePath} contains unsupported setting keys: ${unknownKeys.join(", ")}`);
  }
  if (missingKeys.length > 0) {
    fail(`${relativePath} is missing required setting keys: ${missingKeys.join(", ")}`);
  }
  for (const preference of ["defaultProvider", "defaultModel", "defaultThinkingLevel", "theme"]) {
    if (settings[preference] !== undefined && typeof settings[preference] !== "string") {
      fail(`${relativePath} ${preference} must be a string when present; found: ${JSON.stringify(settings[preference])}`);
    }
  }
  if (expectedSkills !== undefined && !sameJson(settings.skills, expectedSkills)) {
    fail(`${relativePath} skills must be ${JSON.stringify(expectedSkills)}; found: ${JSON.stringify(settings.skills)}`);
  }
  validatePackageList(settings, relativePath, baseDir, packagePrefix);
  return settings;
}

const agentSettings = validateSettingsFile({
  relativePath: "agent/settings.json",
  baseDir: join(root, "agent"),
  allowedKeys: ["defaultModel", "defaultProvider", "defaultThinkingLevel", "packages", "skills", "theme"],
  optionalKeys: ["lastChangelogVersion"],
  packagePrefix: AGENT_PACKAGE_PREFIX,
  expectedSkills: ["./skills"],
});

function validateKeybindings(relativePath) {
  const keybindings = readJson(join(root, relativePath));
  if (!keybindings) return undefined;
  if (keybindings["app.thinking.cycle"] !== "alt+t") {
    fail(`${relativePath} must reserve Shift+Tab by mapping app.thinking.cycle to alt+t`);
  }
  if (keybindings["app.model.cycleForward"] !== "alt+m") {
    fail(`${relativePath} must map app.model.cycleForward to alt+m`);
  }
  return keybindings;
}

const rootKeybindings = validateKeybindings("keybindings.json");
const agentKeybindings = validateKeybindings("agent/keybindings.json");
if (rootKeybindings && agentKeybindings && !sameJson(rootKeybindings, agentKeybindings)) {
  fail("agent/keybindings.json must mirror root keybindings.json");
}

function collectSkillFiles(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read skill directory ${rel(directory)}: ${error.message}`);
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectSkillFiles(path, found);
    else if (entry.isFile() && entry.name === "SKILL.md") found.push(path);
  }
  return found;
}

const skillFiles = collectSkillFiles(join(root, "skills"));
if (skillFiles.length !== EXPECTED_SKILL_COUNT) {
  fail(`expected ${EXPECTED_SKILL_COUNT} global SKILL.md files; found ${skillFiles.length}`);
}
for (const skillFile of skillFiles) {
  const prefix = readFileSync(skillFile, "utf8").slice(0, 16 * 1024);
  const frontmatter = prefix.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter || !/^name:\s*\S+/m.test(frontmatter)) {
    fail(`${rel(skillFile)} is missing frontmatter name`);
  }
  const lines = frontmatter?.split(/\r?\n/) ?? [];
  const descriptionIndex = lines.findIndex((line) => line.startsWith("description:"));
  if (descriptionIndex < 0) {
    fail(`${rel(skillFile)} is missing frontmatter description`);
    continue;
  }
  const first = lines[descriptionIndex].slice("description:".length).trim();
  let normalizedDescription = first;
  if (["|", "|-", ">", ">-"].includes(first)) {
    const body = [];
    for (const line of lines.slice(descriptionIndex + 1)) {
      if (!/^\s+/.test(line)) break;
      body.push(line.trim());
    }
    normalizedDescription = body.join("\n");
  }
  if (!normalizedDescription.trim()) {
    fail(`${rel(skillFile)} has an empty frontmatter description`);
  } else if (normalizedDescription.length > 1024) {
    fail(`${rel(skillFile)} description exceeds 1024 characters (${normalizedDescription.length})`);
  }
}

const expectedDefinitions = ["planner.md", "reviewer.md", "scout.md", "worker.md"];
let actualDefinitions = [];
try {
  actualDefinitions = readdirSync(join(root, "subagents")).filter((name) => name.endsWith(".md")).sort();
} catch (error) {
  fail(`cannot read subagents/: ${error.message}`);
}
if (!sameJson(actualDefinitions, expectedDefinitions)) {
  fail(`subagents/ definitions must be exactly: ${expectedDefinitions.join(", ")}; found: ${actualDefinitions.join(", ")}`);
}
for (const name of actualDefinitions) {
  const stat = lstatSync(join(root, "subagents", name));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    fail(`subagents/${name} must be an independent ordinary file`);
  }
}
const expectedRoleDefinitions = new Map([
  ["worker.md", { model: "openai-codex/gpt-5.6-sol", tools: ["read", "bash", "edit", "write", "grep", "find", "ls"] }],
  ["reviewer.md", { model: "openai-codex/gpt-5.6-terra", tools: ["read", "bash", "grep", "find", "ls"] }],
]);
for (const [name, expected] of expectedRoleDefinitions) {
  const content = readFileSync(join(root, "subagents", name), "utf8");
  const actualModel = content.match(/^model:\s*(\S+)\s*$/m)?.[1];
  if (actualModel !== expected.model) {
    fail(`subagents/${name} model must be ${expected.model}; found: ${actualModel ?? "none"}`);
  }
  const actualTools = content.match(/^tools:\s*\[([^\]]*)\]\s*$/m)?.[1].split(",").map((tool) => tool.trim());
  if (!sameJson(actualTools, expected.tools)) {
    fail(`subagents/${name} tools must be ${expected.tools.join(", ")}; found: ${(actualTools ?? []).join(", ")}`);
  }
  if (!/^peers:\s*false\s*$/m.test(content)) {
    fail(`subagents/${name} must route coordination through the main agent`);
  }
}
const issueReviewerDefinition = readFileSync(join(root, "subagents", "reviewer.md"), "utf8");
for (const requiredText of ["## Decision", "completed | waiting | blocked", "## Question / blocker", "not-completed"]) {
  if (!issueReviewerDefinition.includes(requiredText)) {
    fail(`subagents/reviewer.md is missing continuation guidance: ${requiredText}`);
  }
}
const issueMaintenanceEvals = readJson(join(root, "skills", "github-issue-maintenance", "evals", "evals.json"));
if (issueMaintenanceEvals?.skill_name !== "github-issue-maintenance") {
  fail("github-issue-maintenance evals must name the skill");
}
const issueMaintenanceEvalItems = issueMaintenanceEvals?.evals;
if (!Array.isArray(issueMaintenanceEvalItems)) {
  fail("github-issue-maintenance evals must be an array");
} else {
  const expectedEvalIds = Array.from({ length: 30 }, (_, index) => index + 1);
  const actualEvalIds = issueMaintenanceEvalItems.map((item) => item?.id);
  if (!sameJson(actualEvalIds, expectedEvalIds)) {
    fail(`github-issue-maintenance eval IDs must be ${expectedEvalIds.join(", ")}`);
  }
  for (const item of issueMaintenanceEvalItems) {
    if (!Number.isInteger(item?.id)) fail("github-issue-maintenance eval id must be an integer");
    if (typeof item?.prompt !== "string" || !item.prompt.trim()) fail(`github-issue-maintenance eval ${item?.id ?? "unknown"} needs a prompt`);
    if (typeof item?.expected_output !== "string" || !item.expected_output.trim()) {
      fail(`github-issue-maintenance eval ${item?.id ?? "unknown"} needs expected_output`);
    }
  }
}
// The portable workflow owns policy; Pi-specific lifecycle details live in its adapter.
requireGuidance("skills/github-issue-maintenance/SKILL.md", [
  "Do not create an `issue-maintainer` subagent",
  "Without an explicit run request, do not create claims or ledgers",
  "[Pi runtime adapter](references/pi-runtime.md)",
  "persistent, issue-scoped worker/reviewer instances, independent review",
  "explicit true/false gates",
  "separate worker publication assignment",
  "Do not bypass review to publish",
  "Never replay history to promote a rejected claim",
  "Require a dedicated isolated worktree for each fix-issue epoch",
  "Include the resolved base branch/ref in the brief",
  "A later reopen starts a new epoch",
  "partial-retirement",
  "both retirements and roster absence are verified",
  "keep private paths, session IDs, team bindings, and ledgers out of GitHub text",
]);
requireGuidance("skills/github-issue-maintenance/references/pi-runtime.md", [
  "subagent_status", "subagent_spawn", "subagent_send", "subagent_await", "subagent_retire",
  "ownerScopeId",
  "<repo-id>-i<issue-number>-e<epoch-index>",
  "canonical decimal issue number `1..9999999999` and epoch index `0..9999999999`",
  "repository ID is at most 226 characters and the team ID at most 250",
  "Never guess the index after history/state loss or reuse a retired ID",
  "Bindings must include the host",
  "Only after verified ownership of a durable claim",
  "require exact host/repository/issue/epoch/team/scope equality",
  "both recorded addresses in the roster",
  "Await the exact `{to, anchorId}`",
  "`error`: stop and report failure",
  "`retired`: the persistent specialist disappeared",
  "A completed final `waiting`/`blocked` report with a question consumes that anchor",
  "Execute only under the run's authorized `after-verified-closure` policy",
  "partial-retirement",
  "absence alone is not proof",
  "Until then, do not create a next-epoch pair",
]);
requireGuidance("configs/pi-agent/docs/agents/notes/pi-agent/main-agent-issue-maintenance/main-agent-issue-maintenance.md", [
  "[Maintenance workflow](../../../../../../../skills/github-issue-maintenance/SKILL.md)",
  "[Pi runtime adapter](../../../../../../../skills/github-issue-maintenance/references/pi-runtime.md)",
  "[Evaluation scenarios](../../../../../../../skills/github-issue-maintenance/evals/evals.json)",
  "Review cannot be bypassed",
]);
requireGuidance("skills/pi-plan-mode/SKILL.md", ["name: pi-plan-mode", "disable-model-invocation: true"]);
requireGuidance("configs/pi-agent/packages/pi-plan/extensions/plan/index.ts", [
  'const PLAN_SKILL_NAME = "pi-plan-mode";',
]);

const criticalEvalClauses = new Map([
  [1, ["at most one oldest eligible issue", "only after a durable fix claim"]],
  [2, ["subagent_send", "subagent_await"]],
  [3, ["creates or wakes no worker/reviewer pair"]],
  [4, ["-i<issue>-e<epoch>", "never reuses a retired epoch"]],
  [5, ["host/repository/issue/epoch/team/scope/address binding before assignments"]],
  [6, ["Does not bypass", "separate publication assignment", "commit, push, and PR gates"]],
  [7, ["226-character repository ID", "250-character team ID", "canonical decimal and byte bounds"]],
  [8, ["waiting without posting a claim or creating specialists"]],
  [9, ["excludes local paths", "scope/team/session identifiers"]],
  [10, ["Leaves the main model unchanged", "neither duplicates stale pins nor silently substitutes models"]],
  [11, ["owning sessions", "no silent reuse, adoption, or replacement"]],
  [12, ["changed edit time or exact body hash", "never promotes the rejected claim"]],
  [13, ["no publication or automatic replacement", "does not infer safe retirement"]],
  [14, ["Consumes the old anchor", "new envelopeId", "exact to/anchorId"]],
  [15, ["Reuses its exact pair", "retire before closure"]],
  [16, ["close/reopen delimiters", "both old specialists", "fresh non-reused addresses"]],
  [17, ["Rejects every listed value under canonical decimal bounds"]],
  [18, ["partial-retirement", "creates no next-epoch pair", "both successful retirements and absence are verified"]],
  [19, ["without activating this workflow"]],
  [20, ["skill-authoring/review work only"]],
  [21, ["Rejects issue-body authority", "retains independent review", "never uploads the private ledger"]],
  [22, ["Skips the older ineligible issue", "Does not create or add the label automatically"]],
  [23, ["Uses manual retirement", "not inherited user consent"]],
  [24, ["waiting before claiming new work", "does not silently use one-shots"]],
  [25, ["never an unsupported --repo flag"]],
  [26, ["Does not equate absence with verified retirement"]],
  [27, ["requires host equality", "stops rather than adopting colliding addresses"]],
  [28, ["release/2.x base explicitly", "neither coordinator nor worker silently substitutes main"]],
  [29, ["dedicated isolated worktree", "without stashing or resetting"]],
  [30, ["Stops for clarification before branching or implementation"]],
]);
for (const [id, clauses] of criticalEvalClauses) {
  const output = issueMaintenanceEvalItems?.find((item) => item?.id === id)?.expected_output ?? "";
  for (const clause of clauses) {
    if (!output.includes(clause)) fail(`github-issue-maintenance eval ${id} is missing required clause: ${clause}`);
  }
}

function requireGuidance(relativePath, clauses) {
  let content;
  try {
    content = readFileSync(join(root, relativePath), "utf8").replace(/\s+/g, " ");
  } catch (error) {
    fail(`cannot read required guidance ${relativePath}: ${error.message}`);
    return;
  }
  for (const clause of clauses) {
    if (!content.includes(clause)) fail(`${relativePath} is missing required guidance: ${clause}`);
  }
}

const delegatedReviewPaths = [
  join(root, "procedures", "reviews", "delegated-review-results", "delegated-review-results.md"),
  join(root, "configs", "pi-agent", "docs", "agents", "procedures", "reviews", "delegated-review-results", "delegated-review-results.md"),
];
const delegatedReviewProcedures = delegatedReviewPaths.map((path) => readFileSync(path, "utf8"));
if (delegatedReviewProcedures[0] !== delegatedReviewProcedures[1]) {
  fail("delegated-review-results procedure copies must stay synchronized");
}
for (const obsoleteText of ["waitFor:", "subagent_collect", "`attention`"]) {
  if (delegatedReviewProcedures[0].includes(obsoleteText)) {
    fail(`delegated-review-results uses obsolete Pi Subagents guidance: ${obsoleteText}`);
  }
}
for (const requiredText of ["targets:", "anchorId:", "completed", "error", "retired", "timeout", "new envelope ID"]) {
  if (!delegatedReviewProcedures[0].includes(requiredText)) {
    fail(`delegated-review-results is missing current lifecycle guidance: ${requiredText}`);
  }
}
const currentSubagentDocs = [
  join(root, "configs", "subagent-docs", "03-tool-surface.md"),
  join(root, "configs", "pi-agent", "packages", "pi-subagents", "README.md"),
  join(root, "configs", "pi-agent", "docs", "agents", "notes", "architecture", "session-scoped-subagents-implementation", "session-scoped-subagents-implementation.md"),
  join(root, "configs", "pi-agent", "docs", "agents", "plans", "pi-agent", "subagent-session-ownership-and-result-delivery", "subagent-session-ownership-and-result-delivery.md"),
  join(root, "configs", "pi-agent", "docs", "agents", "plans", "pi-agent", "pi-subagents", "pi-subagents.md"),
];
for (const docPath of currentSubagentDocs) {
  const content = readFileSync(docPath, "utf8");
  for (const obsoleteText of ["waitFor:", "subagent_collect", "status:\"attention\"", "completed: [...]", "adopt-legacy", "pi-agents"]) {
    if (content.includes(obsoleteText)) {
      fail(`${rel(docPath)} uses obsolete Pi Subagents guidance: ${obsoleteText}`);
    }
  }
}
const activeToolSurface = readFileSync(currentSubagentDocs[0], "utf8");
for (const requiredText of ["ownerScopeId", "outcomes", "completed", "error", "retired", "new envelope ID"]) {
  if (!activeToolSurface.includes(requiredText)) {
    fail(`current Pi Subagents tool surface is missing: ${requiredText}`);
  }
}
const currentSubagentPlan = readFileSync(currentSubagentDocs[4], "utf8");
for (const requiredText of [
  "payload.terminalAnchors",
  "drained-turn snapshot",
  "all and only its stamped targets",
  "Pre-migration final reports without the list",
  "legacy unscoped error",
  "`completed` or `error`",
  "`retired`",
]) {
  if (!currentSubagentPlan.includes(requiredText)) {
    fail(`current Pi Subagents plan is missing exact-anchor guidance: ${requiredText}`);
  }
}
if (currentSubagentPlan.includes("correlationId === anchorId && final === true")) {
  fail("current Pi Subagents plan uses the retired correlation-only await matcher");
}
const historicalSubagentDocs = [
  join(root, "configs", "subagent-docs", "00-design-log.md"),
  join(root, "configs", "subagent-docs", "01-power-matrix.md"),
  join(root, "configs", "subagent-docs", "02-envelope-contract.md"),
  join(root, "configs", "subagent-docs", "04-type-schema.md"),
  join(root, "configs", "subagent-docs", "05-tui-spec.md"),
  join(root, "configs", "subagent-docs", "06-architecture.md"),
  join(root, "configs", "subagent-docs", "pi-agents-historical-implementation.html"),
  join(root, "configs", "pi-agent", "docs", "agents", "plans", "architecture", "session-scoped-subagents-and-reliable-results", "session-scoped-subagents-and-reliable-results.md"),
  join(root, "configs", "pi-agent", "docs", "agents", "notes", "architecture", "session-scoped-subagents-impact", "session-scoped-subagents-impact.md"),
];
for (const docPath of historicalSubagentDocs) {
  if (!readFileSync(docPath, "utf8").slice(0, 600).toLowerCase().includes("superseded")) {
    fail(`${rel(docPath)} must be marked as superseded historical guidance`);
  }
}
const subagentCoreSource = readFileSync(join(root, "configs", "pi-agent", "packages", "pi-subagents", "extensions", "subagents", "core.ts"), "utf8");
const subagentToolSource = readFileSync(join(root, "configs", "pi-agent", "packages", "pi-subagents", "extensions", "subagents", "tools", "main-agent.ts"), "utf8");
const subagentRuntimeSource = readFileSync(join(root, "configs", "pi-agent", "packages", "pi-subagents", "extensions", "subagents", "runtime", "in-process.ts"), "utf8");
const subagentAwaitTest = readFileSync(join(root, "configs", "pi-agent", "packages", "pi-subagents", "test", "e2e", "phase4-await.mjs"), "utf8");
const subagentResumeTest = readFileSync(join(root, "configs", "pi-agent", "packages", "pi-subagents", "test", "e2e", "phase7-resume.mjs"), "utf8");
if (!subagentCoreSource.includes("ownerScopeId") || !subagentCoreSource.includes("createHash(\"sha256\")")) {
  fail("pi-subagents core must derive an opaque ownerScopeId");
}
if (!subagentToolSource.includes("ownerScopeId: core.ownerScopeId")) {
  fail("subagent_status must return ownerScopeId");
}
if (!subagentResumeTest.includes("owner scope fingerprint survives resume") || !subagentResumeTest.includes("createStatusTool")) {
  fail("pi-subagents resume tests must cover ownerScopeId continuity and status exposure");
}
if (!subagentRuntimeSource.includes('terminal.kind === "legacy-unscoped-error" || terminal.anchors.includes(target.anchorId)')) {
  fail("pi-subagents await must distinguish legacy unscoped errors from modern empty snapshots");
}
if (!subagentAwaitTest.includes("explicit empty error snapshot resolves nothing")) {
  fail("pi-subagents await tests must cover modern empty and legacy unscoped errors");
}
if (existsSync(join(root, "configs", "subagent-docs", "pi-agents-current-implementation.html"))) {
  fail("obsolete current-implementation HTML name must not remain");
}
if (existsSync(join(root, "teams"))) {
  fail("legacy teams/ definition directory must be absent; Pi Teams uses subagents/");
}

let tracked = [];
try {
  tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  if (untracked.length > 0) {
    fail(`nonignored files are not tracked and would be absent from a clone:\n${untracked.join("\n")}`);
  }
} catch (error) {
  fail(`cannot inspect tracked files: ${error.message}`);
}
for (const requiredRoot of ["codex/", "configs/", "mcp/", "plans/", "procedures/"]) {
  if (!tracked.some((path) => path.startsWith(requiredRoot))) {
    fail(`lowercase shared directory is absent from the tracked clone: ${requiredRoot}`);
  }
}
for (const requiredAgentEntry of [
  "agent/AGENTS.md",
  "agent/configs",
  "agent/keybindings.json",
  "agent/settings.json",
  "agent/skills",
  "agent/subagents",
  "agent/procedures",
]) {
  if (!tracked.includes(requiredAgentEntry)) {
    fail(`tracked agent-dir compatibility entry is missing: ${requiredAgentEntry}`);
  }
}
for (const path of tracked) {
  if (/^(Codex|Configs|MCP|Plans|Procedures)(\/|$)/.test(path)) {
    fail(`tracked repository-owned path has obsolete capitalized directory casing: ${path}`);
  }
  if (/^(codex\/(Configs|Plugins)|configs\/(PiAgent|Podman|Subagent-Docs))(\/|$)/.test(path)) {
    fail(`tracked nested repository-owned path has obsolete capitalized directory casing: ${path}`);
  }
}

const forbiddenExact = new Set([
  "auth.json",
  "oauth.json",
  "models.json",
  "mcp.json",
  "mcp-auth.json",
  "mcp.log",
  "mcp.log.1",
  "models-store.json",
  "trust.json",
  "safety.json",
  "safety-audit.jsonl",
  "subagents.json",
  "teams.json",
  "procedures.json",
]);
const forbiddenRuntimeDirs = /^(sessions|npm|install|git|bin|tools|tmp)\//;
function isPrivateRuntimePath(path) {
  if (forbiddenExact.has(path) || forbiddenRuntimeDirs.test(path)) return true;
  if (!path.startsWith("agent/")) return false;
  const nested = path.slice("agent/".length);
  return forbiddenExact.has(nested) || forbiddenRuntimeDirs.test(nested);
}
for (const path of tracked) {
  if (isPrivateRuntimePath(path)) {
    fail(`tracked private/runtime path: ${path}`);
  }
  const ignored = spawnSync("git", ["-C", root, "check-ignore", "--no-index", "-q", path]);
  if (ignored.status === 0) fail(`tracked path matches the private/runtime ignore policy: ${path}`);
  else if (ignored.status !== 1) fail(`could not evaluate ignore policy for tracked path: ${path}`);
}

const agentInstructionPath = "agent/AGENTS.md";
const expectedAgentInstructions = [
  "# Global Agent Instructions",
  "",
  "Read `../AGENTS.md`, resolved relative to this file's directory, for the authoritative",
  "global instructions. Do not resolve this path relative to the current working directory.",
  "",
].join("\n");
try {
  const instructionFile = join(root, agentInstructionPath);
  if (!lstatSync(instructionFile).isFile()) {
    fail(`${agentInstructionPath} must be a regular instruction pointer file`);
  } else if (readFileSync(instructionFile, "utf8").replace(/\r\n/g, "\n") !== expectedAgentInstructions) {
    fail(`${agentInstructionPath} must contain only the canonical instruction pointer`);
  }
} catch (error) {
  fail(`cannot inspect instruction pointer: ${error.message}`);
}

const allowedSymlinks = new Map([
  ["agent/configs", "../configs"],
  ["agent/skills", "../skills"],
  ["agent/subagents", "../subagents"],
  ["agent/procedures", "../procedures"],
]);
try {
  const linkedEntries = git(["ls-files", "-s"])
    .split("\n")
    .filter((line) => line.startsWith("120000 "));
  for (const entry of linkedEntries) {
    const path = entry.split(/\s+/).at(-1);
    // Validate the working-tree pointer above while its type change is still unstaged.
    if (path === agentInstructionPath) continue;
    const expectedTarget = allowedSymlinks.get(path);
    if (!expectedTarget) {
      fail(`tracked symlink is not an approved agent-dir shim: ${entry}`);
      continue;
    }
    const actualTarget = readlinkSync(join(root, path)).replaceAll("\\", "/");
    if (actualTarget !== expectedTarget) {
      fail(`${path} must point to ${expectedTarget}; found ${actualTarget}`);
    }
  }
  for (const path of allowedSymlinks.keys()) {
    if (tracked.includes(path)) {
      const mode = git(["ls-files", "-s", "--", path]).trim().split(/\s+/)[0];
      if (mode !== "120000") fail(`${path} must be a relative symlink agent-dir shim`);
    }
  }
} catch (error) {
  fail(`cannot inspect tracked symlinks: ${error.message}`);
}

for (const ignoredPath of [
  "auth.json",
  "oauth.json",
  "models.json",
  "mcp.json",
  "mcp-auth.json",
  "mcp.log",
  "mcp.log.1",
  "sessions/probe.jsonl",
  "trust.json",
  "models-store.json",
  "npm/probe",
  "install/probe",
  "git/probe",
  "bin/probe",
  "tmp/pi-global-config-migration/probe",
  "safety.json",
  "safety-audit.jsonl",
  "subagents.json",
  "teams.json",
  "procedures.json",
  "agent/auth.json",
  "agent/oauth.json",
  "agent/models.json",
  "agent/mcp.json",
  "agent/mcp-auth.json",
  "agent/mcp.log",
  "agent/mcp.log.1",
  "agent/sessions/probe.jsonl",
  "agent/trust.json",
  "agent/models-store.json",
  "agent/npm/probe",
  "agent/install/probe",
  "agent/git/probe",
  "agent/bin/probe",
  "agent/tmp/probe",
  "agent/safety.json",
  "agent/safety-audit.jsonl",
  "agent/subagents.json",
  "agent/teams.json",
  "agent/procedures.json",
  ".claude/probe",
  ".env",
  "private/id_ed25519",
]) {
  const result = spawnSync("git", ["-C", root, "check-ignore", "--no-index", "-q", ignoredPath]);
  if (result.status !== 0) fail(`expected ignored path is not covered: ${ignoredPath}`);
}

notes.push(`${agentSettings?.packages?.length ?? 0} agent-dir package paths`);
notes.push(`${skillFiles.length} global skills`);
notes.push(`${expectedDefinitions.length} shared subagent/team definitions`);

if (failures.length > 0) {
  console.error("Global Pi configuration validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Global Pi configuration validation passed (${notes.join(", ")}).`);
}

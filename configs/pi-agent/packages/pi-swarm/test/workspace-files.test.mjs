import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, symlinkSync, linkSync, chmodSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { WorkspaceFiles, hash } from "../extensions/swarm/workspace-files.mjs";
import { repository } from "./helpers.mjs";

test("read-only fingerprints cover files, modes, ignored files and Git index without writes", t => {
 const root = repository(t);
 const files = new WorkspaceFiles(root);
 writeFileSync(join(root, "source.txt"), "original");
 const first = files.fingerprint("source.txt");
 assert.equal(files.path("./source.txt"), "source.txt");
 assert.equal(files.fingerprint("source.txt"), first);
 writeFileSync(join(root, "source.txt"), "external");
 assert.notEqual(files.fingerprint("source.txt"), first);
 const beforeMode = files.snapshot(); chmodSync(join(root, "source.txt"), 0o600);
 if (process.platform !== "win32") assert.notEqual(files.snapshot(), beforeMode);
 const beforeIgnored = files.snapshot(); writeFileSync(join(root, "ignored.txt"), "work");
 assert.notEqual(files.snapshot(), beforeIgnored);
 const beforeIndex = files.snapshot(); execFileSync("git", ["-C", root, "add", "source.txt"]);
 assert.notEqual(files.snapshot(), beforeIndex);
 assert.equal(hash("hello"), hash(Buffer.from("hello")));
});

test("path guard refuses traversal, control files, symlinks and hardlinks", t => {
 const root = repository(t); const files = new WorkspaceFiles(root, { protectedPaths: ["private"] });
 writeFileSync(join(root, "file"), "data");
 symlinkSync(join(root, "file"), join(root, "alias"));
 linkSync(join(root, "file"), join(root, "hard"));
 for (const path of ["../outside", ".git/config", "private/a", "alias", "hard", ""]) assert.throws(() => files.path(path));
});

test("snapshots work without Git and detect a replaced root", t => {
 const root = repository(t); const project = join(root, "plain"); mkdirSync(project);
 const files = new WorkspaceFiles(project); const first = files.snapshot();
 writeFileSync(join(project, "work.txt"), "work"); assert.notEqual(files.snapshot(), first);
 renameSync(project, join(root, "previous")); mkdirSync(project);
 assert.throws(() => files.snapshot(), /identity changed/);
});

test("native coding definitions retain SDK schemas, renderers and output metadata", async () => {
 const { codingDefinitions } = await import("../extensions/swarm/session-tools.mjs");
 const tools = codingDefinitions(process.cwd());
 assert.deepEqual(tools.map(tool => tool.name), ["read", "edit", "write", "bash"]);
 assert.ok(tools.every(tool => typeof tool.execute === "function" && typeof tool.renderCall === "function"));
 assert.ok(tools[0].parameters.properties.limit);
 assert.ok(tools[3].parameters.properties.timeout);
});

#!/usr/bin/env node
/**
 * Verify the staged package snapshot without copying unstaged/imported changes.
 * Usage: node <script> <package-directory> <shared-test-directory>
 * Native Windows only. Requires Git, the installed SDK and trusted offline tests.
 * Runs the package's top-level *.test.mjs files with its existing SDK register hook.
 * Writes only a disposable temp fixture/log; removes it on success, retains failure
 * evidence. Does not stage, commit, install, initialize submodules or touch work files.
 */
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const [packageDirectory, sharedTestDirectory, ...extra] = process.argv.slice(2);
if (process.platform !== "win32") throw new Error("Native Windows is required; do not substitute WSL/Linux.");
if (extra.length || !validDirectory(packageDirectory) || !validDirectory(sharedTestDirectory)) {
	throw new Error("Usage: node <script> <package-directory> <shared-test-directory>; use repository-relative directories.");
}
const root = git(["rev-parse", "--show-toplevel"]).trim();
const indexed = git(["ls-files", "-z", "--", packageDirectory, sharedTestDirectory], root);
const files = indexed.split("\0").filter(Boolean);
if (!files.length) throw new Error("No indexed package/test files found.");
const fixture = mkdtempSync(join(tmpdir(), "staged-package-tests-"));
try {
	const prefix = fixture.split(sep).join("/") + "/";
	git(["checkout-index", "--prefix=" + prefix, "--", ...files], root);
	const cwd = join(fixture, packageDirectory);
	if (!existsSync(join(cwd, "test", "sdk-register.mjs"))) throw new Error("Package has no supported SDK registration hook.");
	const tests = readdirSync(join(cwd, "test")).filter(name => name.endsWith(".test.mjs")).map(name => "test/" + name);
	if (!tests.length) throw new Error("Package has no top-level test files.");
	const result = spawnSync(process.execPath, ["--experimental-import-meta-resolve", "--import", "./test/sdk-register.mjs", "--test", "--test-reporter=tap", ...tests], {
		cwd, encoding: "utf8", timeout: 240000, maxBuffer: 12 * 1024 * 1024,
	});
	const output = (result.stdout ?? "") + "\n" + (result.stderr ?? "");
	writeFileSync(join(fixture, "native-index-tests.log"), output);
	console.log("Native Windows staged-snapshot suite exit:", result.status);
	for (const line of output.split(/\r?\n/)) {
		if (/^(# (tests|suites|pass|fail|cancelled|skipped|todo|duration)|not ok|  error:|  code:)/.test(line)) console.log(line);
	}
	if (result.status !== 0) {
		console.log("Retained disposable fixture:", fixture);
		if (result.error) console.log("Test process error:", result.error.code);
		process.exitCode = 1;
	} else {
		rmSync(fixture, { recursive: true, force: true });
		console.log("Removed only this disposable fixture; repository files/index were unchanged.");
	}
} catch (error) {
	console.error("Snapshot verification failed; retained disposable fixture:", fixture);
	throw error;
}

function git(args, cwd) {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function validDirectory(value) {
	if (typeof value !== "string" || !value || value.startsWith("-") || value.includes("\\") || value.includes(":")) return false;
	return value.split("/").every(part => part && part !== "." && part !== ".." && !/[\x00-\x1f]/.test(part));
}

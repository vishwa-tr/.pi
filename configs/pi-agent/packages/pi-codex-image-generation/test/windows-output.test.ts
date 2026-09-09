import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
	saveWindowsOutput,
	validateWindowsOutput,
	validateWindowsOutputPath,
} from "../extensions/codex-image-generation/windows-output.ts";

const windowsOnly = { skip: process.platform !== "win32" };
const nonWindowsOnly = { skip: process.platform === "win32" };

test("rejects ambiguous and reserved Windows output paths", () => {
	validateWindowsOutputPath("images/result.png");
	for (const path of [
		"../result.png",
		"C:\\result.png",
		"\\\\server\\share\\result.png",
		"images/result.png:stream",
		"images/result.png.",
		"images/CON.png",
	]) {
		assert.throws(() => validateWindowsOutputPath(path));
	}
});

test("writes and atomically replaces an image through the WSL helper", windowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-image-windows-output-test-"));
	try {
		await mkdir(join(root, "nested"));
		const approvedRoot = await realpath(root);
		const target = join(root, "nested", "result.png");
		await validateWindowsOutput(approvedRoot, target, "nested/result.png", false);
		await saveWindowsOutput(approvedRoot, target, "nested/result.png", Buffer.from("first"), false);
		await assert.rejects(
			saveWindowsOutput(approvedRoot, target, "nested/result.png", Buffer.from("blocked"), false),
			/Output already exists/,
		);
		await saveWindowsOutput(approvedRoot, target, "nested/result.png", Buffer.from("second"), true);
		assert.equal(await readFile(target, "utf8"), "second");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects Windows symlink parents and targets", windowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-image-windows-confine-test-"));
	const outside = await mkdtemp(join(tmpdir(), "pi-image-windows-outside-test-"));
	try {
		const approvedRoot = await realpath(root);
		await symlink(outside, join(root, "linked-parent"), "dir");
		await assert.rejects(
			saveWindowsOutput(
				approvedRoot,
				join(root, "linked-parent", "escape.png"),
				"linked-parent/escape.png",
				Buffer.from("escape"),
				false,
			),
			/escaped the approved path/,
		);
		assert.equal(existsSync(join(outside, "escape.png")), false);

		const target = join(root, "target.png");
		await writeFile(target, "original");
		await symlink(target, join(root, "linked-output.png"), "file");
		await assert.rejects(
			saveWindowsOutput(
				approvedRoot,
				join(root, "linked-output.png"),
				"linked-output.png",
				Buffer.from("replacement"),
				true,
			),
			/Refusing to replace symbolic link/,
		);
		assert.equal(await readFile(target, "utf8"), "original");
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

test("times out if the helper stalls after commit authorization", nonWindowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-image-windows-timeout-test-"));
	const fakeWslPath = join(root, "wsl.exe");
	const previousPath = process.env.PATH;
	try {
		await writeFile(fakeWslPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--exec" && args[1] === "wslpath") {
	process.stdout.write(args.at(-1) + "\\n");
	process.exit(0);
}
process.stdout.write("READY\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	if (chunk.includes("COMMIT\\n")) setInterval(() => undefined, 1_000);
});
`);
		await chmod(fakeWslPath, 0o700);
		process.env.PATH = `${root}${delimiter}${previousPath ?? ""}`;

		const target = join(root, "stalled.png");
		await assert.rejects(
			saveWindowsOutput(
				await realpath(root),
				target,
				"stalled.png",
				Buffer.from("stalled"),
				false,
				undefined,
				{ helperTimeoutMs: 50, terminationGraceMs: 25 },
			),
			/Windows image-output helper timed out/,
		);
		assert.equal(existsSync(target), false);
	} finally {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		await rm(root, { recursive: true, force: true });
	}
});

test("cancels before committing and removes its temporary image", windowsOnly, async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-image-windows-cancel-test-"));
	try {
		const approvedRoot = await realpath(root);
		const target = join(root, "cancelled.png");
		let checks = 0;
		const abortBeforeCommit = {
			get aborted() {
				checks += 1;
				return checks >= 2;
			},
		} as AbortSignal;
		await assert.rejects(
			saveWindowsOutput(
				approvedRoot,
				target,
				"cancelled.png",
				Buffer.from("cancelled"),
				false,
				abortBeforeCommit,
			),
			/image generation cancelled/,
		);
		assert.deepEqual(await readdir(root), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

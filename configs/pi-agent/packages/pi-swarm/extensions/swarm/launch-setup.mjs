import {
	closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
	readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SwarmError } from "./errors.mjs";
import { WorkspaceFiles } from "./workspace-files.mjs";
import { execFileSync } from "node:child_process";

const fail = message => { throw new SwarmError("SETUP", message); };

/** User-owned prerequisite changes only; never creates a host, run, or commit. */
export async function prepareLaunchCheckout(ctx, { signal, assertCurrent, timeout = 120000 }) {
	assertCurrent();
	if (ctx.mode !== "tui" || !ctx.hasUI) fail("Swarm setup requires interactive TUI confirmation.");
	let root;
	let rootIdentity;
	try {
		root = realpathSync(ctx.cwd);
		rootIdentity = lstatSync(root, { bigint: true });
		if (!rootIdentity.isDirectory()) fail("The project root must be a directory.");
	}
	catch { fail("Cannot inspect the project directory. Check that it exists and is accessible."); }
	const checkContext = assertCurrent;
	// A directory renamed away and replaced can keep the same canonical path.
	// Bind consent to its identity too; this is not an atomic filesystem lock.
	assertCurrent = () => {
		checkContext();
		let currentRoot;
		let currentIdentity;
		try {
			currentRoot = realpathSync(ctx.cwd);
			currentIdentity = lstatSync(root, { bigint: true });
		}
		catch { fail("The project directory is no longer accessible. Inspect it before retrying."); }
		if (currentRoot !== root || !currentIdentity.isDirectory()
			|| currentIdentity.dev !== rootIdentity.dev || currentIdentity.ino !== rootIdentity.ino) {
			fail("The project directory changed during setup. Start again in the intended checkout.");
		}
	};
	let state = inspect(root, assertCurrent);
	if (!state.repository) {
		const approved = await ctx.ui.confirm("Set up Git for Swarm?",
			`Swarm needs Git to protect and review project changes. Initialize Git in exactly ${JSON.stringify(root)}? No files will be staged and no commit will be made. Approved setup remains if you cancel launch later.`, { signal, timeout });
		assertCurrent();
		if (!approved) return false;
		// Reinspect after the dialog: never initialize inside a repository created meanwhile.
		state = inspect(root, assertCurrent);
		if (!state.repository) {
			assertCurrent();
			git(root, ["init", "--quiet"]);
			ctx.ui.notify("Git initialized. This approved setup remains even if launch is cancelled.", "info");
			state = inspect(root, assertCurrent);
		}
	}
	if (!state.ignored) {
		const original = readIgnore(root);
		assertCurrent();
		const approved = await ctx.ui.confirm("Keep Swarm runtime files out of Git?",
			`Append /.swarms/ to the root .gitignore in ${JSON.stringify(root)}? This excludes private Swarm runtime records, not project source. Existing bytes and permissions are preserved. No staging or commits. Approved setup remains if you cancel launch later.`, { signal, timeout });
		assertCurrent();
		if (!approved) return false;
		state = inspect(root, assertCurrent);
		if (!state.repository) fail("The Git checkout changed during setup. Inspect the project and start again.");
		if (!state.ignored) appendIgnore(root, original, assertCurrent);
		ctx.ui.notify("Swarm runtime exclusion is configured. Approved setup changes remain if launch is cancelled.", "info");
	}
	assertCurrent();
	state = inspect(root, assertCurrent);
	if (!state.repository || !state.ignored) fail("Git did not confirm the runtime exclusion. Review root .gitignore rules, then try again.");
	return true;
}

/** Read-only proposal snapshot, including projects that do not yet have Git. */
export function inspectLaunchSetup(cwd) {
	const root = realpathSync(cwd);
	const state = inspectCheckout(root);
	if (!state.ignored) readIgnore(root); // Reject unsafe setup before asking for consent.
	const fingerprint = new WorkspaceFiles(root).snapshot({ includeGit: state.repository });
	const changes = state.repository
		? git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout.split("\0").filter(Boolean)
		: ["Preserve all existing files in this not-yet-versioned project."];
	return { root, ...state, fingerprint, changes,
		actions: [...(!state.repository ? ["git-init"] : []), ...(!state.ignored ? ["append-runtime-ignore"] : [])] };
}

/** Apply only the exact setup actions in an already consented, unchanged snapshot. */
export function applyLaunchSetup(snapshot, assertCurrent) {
	assertCurrent();
	const identity = lstatSync(snapshot.root, { bigint: true });
	const checkContext = assertCurrent;
	assertCurrent = () => {
		checkContext();
		const stat = lstatSync(snapshot.root, { bigint: true });
		if (realpathSync(snapshot.root) !== snapshot.root || stat.dev !== identity.dev || stat.ino !== identity.ino || !stat.isDirectory()) {
			fail("The approved project directory was replaced during setup. Inspect before retrying.");
		}
	};
	const current = inspectLaunchSetup(snapshot.root);
	if (JSON.stringify(current) !== JSON.stringify(snapshot)) fail("Project changed after the proposal. Request a new proposal; nothing was approved for this snapshot.");
	if (snapshot.actions.includes("git-init")) {
		assertCurrent();
		const files = new WorkspaceFiles(snapshot.root);
		const before = files.snapshot({ includeGit: false });
		git(snapshot.root, ["init", "--quiet"]);
		assertCurrent();
		if (files.snapshot({ includeGit: false }) !== before) fail("Project contents changed during Git initialization. Approved Git setup remains; request a new proposal.");
	}
	if (snapshot.actions.includes("append-runtime-ignore")) {
		assertCurrent();
		appendIgnore(snapshot.root, readIgnore(snapshot.root), assertCurrent);
	}
	assertCurrent();
	const result = inspectLaunchSetup(snapshot.root);
	if (!result.repository || !result.ignored) fail("Approved setup did not establish the runtime exclusion. Inspect before retrying; approved changes remain.");
	return result;
}

function inspect(root, assertCurrent) {
	assertCurrent();
	try { return inspectCheckout(root); }
	finally { assertCurrent(); }
}

function inspectCheckout(root) {
	const result = git(root, ["rev-parse", "--show-toplevel"], true);
	if (result.status !== 0) {
		// Only a genuine absent repository can be initialized. Broken metadata, bare
		// repositories and denied access are not an invitation to overwrite setup.
		let parent = root;
		for (;;) {
			try {
				lstatSync(join(parent, ".git"));
				fail("Git metadata could not be read. Repair or select the checkout root before starting Swarm.");
			} catch (error) {
				if (error.code === "SETUP") throw error;
				if (error.code !== "ENOENT") fail("Cannot inspect Git metadata. Check directory permissions before retrying.");
			}
			const next = dirname(parent);
			if (next === parent) break;
			parent = next;
		}
		if (result.status === 128 && result.stderr.includes("not a git repository")) return { repository: false, ignored: false };
		fail("Cannot inspect this Git checkout. Check Git metadata and directory permissions before retrying.");
	}
	let checkout;
	try { checkout = realpathSync(result.stdout.trim()); }
	catch { fail("Cannot resolve the Git checkout root. Check repository metadata and permissions."); }
	if (checkout !== root) fail("Start Pi at the Git checkout root, not a subdirectory. Swarm will not initialize a nested repository or change a parent checkout.");
	if (git(root, ["ls-files", "-z", "--", ".swarms"]).stdout.length) {
		fail("Swarm runtime files are already tracked. Review that state yourself before retrying; Swarm will not unstage, remove, or delete them.");
	}
	const ignored = [".swarms/", ".swarms/probe/events.jsonl"].every(path => {
		const result = git(root, ["check-ignore", "-q", "--", path], true);
		if (![0, 1].includes(result.status)) fail("Cannot verify Git ignore rules. Check their syntax and permissions before retrying.");
		return result.status === 0;
	});
	return { repository: true, ignored };
}

function git(root, args, allowFailure = false) {
	// Ambient Git routing must never redirect a user-approved cwd mutation.
	const configKeys = new Set(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"]);
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") || configKeys.has(key)));
	try {
		const stdout = execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
			encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
			env: { ...env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
		});
		return { status: 0, stdout, stderr: "" };
	} catch (error) {
		if (error.code === "ENOENT") fail("Git is not available. Install or enable Git, then start Swarm again.");
		if (allowFailure && Number.isInteger(error.status)) return { status: error.status, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
		fail("Git setup failed. Check directory permissions and Git configuration. Any approved changes remain; inspect before retrying.");
	}
}

function readIgnore(root) {
	const path = join(root, ".gitignore");
	let fd;
	try {
		let stat;
		try { stat = lstatSync(path); }
		catch (error) { if (error.code === "ENOENT") return { bytes: Buffer.alloc(0) }; throw error; }
		if (!stat.isFile() || stat.nlink !== 1) fail("Root .gitignore must be a regular, non-linked file. Review it yourself before setup.");
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const opened = fstatSync(fd);
		if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) fail("Root .gitignore changed during inspection. Review it and retry.");
		const bytes = readFileSync(fd);
		if (bytes.includes(0)) fail("Root .gitignore contains unsupported data. Review its text encoding before setup.");
		try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
		catch { fail("Root .gitignore must contain valid UTF-8 text. Review its encoding before setup."); }
		return { bytes, stat };
	} catch (error) {
		if (error.code === "SETUP") throw error;
		fail("Cannot safely read root .gitignore. Check its type and permissions before setup.");
	} finally {
		try { if (fd !== undefined) closeSync(fd); }
		catch { fail("Cannot finish reading root .gitignore safely. Check filesystem access before retrying."); }
	}
}

function sameIgnore(a, b) {
	return a.bytes.equals(b.bytes) && a.stat?.ino === b.stat?.ino && a.stat?.dev === b.stat?.dev
		&& a.stat?.mode === b.stat?.mode && a.stat?.mtimeMs === b.stat?.mtimeMs;
}

function appendIgnore(root, original, assertCurrent) {
	const path = join(root, ".gitignore");
	const temporary = join(root, `.gitignore.swarm-${randomUUID()}.tmp`);
	let fd;
	let created = false;
	try {
		if (!sameIgnore(original, readIgnore(root))) fail("Root .gitignore changed during confirmation. Review it and start again; nothing was overwritten.");
		const newline = original.bytes.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
		const separator = original.bytes.length && original.bytes.at(-1) !== 10 ? newline : "";
		const bytes = Buffer.concat([original.bytes, Buffer.from(`${separator}/.swarms/${newline}`)]);
		assertCurrent();
		fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
		created = true;
		assertCurrent();
		writeFileSync(fd, bytes);
		assertCurrent();
		fchmodSync(fd, original.stat ? original.stat.mode & 0o7777 : 0o644);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		if (!sameIgnore(original, readIgnore(root))) fail("Root .gitignore changed during setup. Nothing was overwritten; inspect before retrying.");
		assertCurrent();
		renameSync(temporary, path);
		created = false;
	} catch (error) {
		if (["SETUP", "MODE_DENIED", "OWNERSHIP"].includes(error.code)) throw error;
		fail("Cannot update root .gitignore safely. Check directory permissions. Approved setup changes remain; inspect before retrying.");
	} finally {
		try {
			if (fd !== undefined) closeSync(fd);
			if (created) unlinkSync(temporary);
		} catch { fail("Setup could not clean up its temporary ignore file. Inspect root .gitignore and its temporary sibling before retrying."); }
	}
}

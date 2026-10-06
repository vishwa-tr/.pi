import test from "node:test";
import assert from "node:assert/strict";
import {
	appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, readFileSync,
	renameSync, rmSync, symlinkSync, writeFileSync, writeSync, fsyncSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareLayout } from "../extensions/swarm/store/layout.mjs";
import { acquireLease } from "../extensions/swarm/store/lease.mjs";
import { openJournal } from "../extensions/swarm/store/journal.mjs";
import { privateDirectory, writeAll } from "../extensions/swarm/store/files.mjs";
import { repository } from "./helpers.mjs";

function storage(t, runId = "run1") {
	const root = repository(t);
	const layout = prepareLayout(root, runId);
	const lease = acquireLease(layout);
	privateDirectory(layout.runRoot);
	return { root, layout, lease };
}

test("state layout is pure, external to the project, and needs no Git ignore rule", t => {
 const root = repository(t, false);
 const layout = prepareLayout(root, "run1");
 assert.ok(!layout.stateRoot.startsWith(root + "/"));
 assert.equal(existsSync(layout.stateRoot), false);
 assert.throws(() => prepareLayout(root, "../escape"), /identifier/);
 const lease = acquireLease(layout); lease.release();
 assert.equal(existsSync(join(root, ".gitignore")), false);
});

test("state directories reject symlinks and non-private permissions", t => {
 const root = repository(t);
 const layout = prepareLayout(root, "run1");
 const parent = join(layout.stateRoot, "..");
 mkdirSync(parent, { recursive: true, mode: 0o700 });
 mkdirSync(join(root, "other"));
 symlinkSync(join(root, "other"), layout.stateRoot);
 assert.throws(() => acquireLease(layout), /Unsafe state directory|symbolic link/);
 rmSync(layout.stateRoot);
 mkdirSync(layout.stateRoot, { mode: 0o755 });
 if (process.platform !== "win32") assert.throws(() => acquireLease(layout), /private/);
});

test("one controller owns the checkout across processes and no stale lock is stolen", t => {
	const { layout, lease } = storage(t);
	assert.throws(() => acquireLease(layout), { code: "EEXIST" });
	const moduleUrl = new URL("../extensions/swarm/store/lease.mjs", import.meta.url).href;
	const program = `import { acquireLease } from ${JSON.stringify(moduleUrl)}; try { acquireLease(JSON.parse(process.argv[1])); process.exitCode = 2; } catch (e) { if (e.code !== 'EEXIST') throw e; }`;
	execFileSync(process.execPath, ["--input-type=module", "-e", program, JSON.stringify(layout)]);
	lease.release();
	mkdirSync(layout.ownerPath, { mode: 0o700 });
	assert.throws(() => acquireLease(layout), { code: "EEXIST" });
});

test("paused reservation survives live-owner release and blocks a different run", t => {
	const { root, layout, lease } = storage(t);
	lease.release();
	const other = prepareLayout(root, "run2");
	assert.throws(() => acquireLease(other), /another running or paused swarm/);
	const resumed = acquireLease(layout);
	resumed.release({ retainReservation: false });
	const next = acquireLease(other);
	next.release({ retainReservation: false });
});

test("lease tokens and directory identities fence release", t => {
	const { layout, lease } = storage(t);
	const ownerFile = join(layout.ownerPath, "owner.json");
	writeFileSync(ownerFile, JSON.stringify({ token: "other", runId: layout.runId }), { mode: 0o600 });
	assert.throws(() => lease.assertOwned(), /lost/);
	assert.throws(() => lease.release({ retainReservation: false }), /lost/);
	assert.equal(existsSync(layout.reservationPath), true);
	assert.equal(existsSync(ownerFile), true);
});

test("corrupt reservations are preserved rather than silently reset", t => {
	const { layout, lease } = storage(t);
	lease.release();
	writeFileSync(layout.reservationPath, "invalid-json", { mode: 0o600 });
	assert.throws(() => acquireLease(layout));
	assert.equal(readFileSync(layout.reservationPath, "utf8"), "invalid-json");
});

test("journal acknowledges after sync and returns detached replay values", t => {
	const { layout, lease } = storage(t);
	const calls = [];
	let journal = openJournal(layout.journalPath, lease.assertOwned, {
		writeAll(fd, bytes) { calls.push("write"); writeAll(fd, bytes); },
		sync(fd) { calls.push("sync"); fsyncSync(fd); },
	});
	const input = { type: "test", nested: { value: 1 } };
	assert.equal(journal.append(input), 1);
	assert.deepEqual(calls, ["write", "sync"]);
	input.nested.value = 2;
	const replay = journal.readAll(); replay[0].nested.value = 3;
	assert.equal(journal.readAll()[0].nested.value, 1);
	journal.close();
	journal = openJournal(layout.journalPath, lease.assertOwned);
	assert.equal(journal.readAll()[0].nested.value, 1);
	assert.equal(journal.append({ type: "second" }), 2);
	journal.close(); lease.release({ retainReservation: false });
});

for (const corruption of ["partial", "checksum", "version", "sequence", "unknown-field", "invalid-utf8"]) {
	test(`journal rejects ${corruption} corruption without modifying it`, t => {
		const { layout, lease } = storage(t);
		const journal = openJournal(layout.journalPath, lease.assertOwned);
		journal.append({ type: "test" }); journal.close();
		let contents = readFileSync(layout.journalPath, "utf8");
		if (corruption === "partial") contents = contents.trimEnd();
		else if (corruption === "invalid-utf8") contents = Buffer.from([0xff, 0x0a]);
		else {
			const record = JSON.parse(contents);
			if (corruption === "checksum") record.payload.type = "changed";
			if (corruption === "version") record.version = 2;
			if (corruption === "sequence") record.sequence = 8;
			if (corruption === "unknown-field") record.extra = true;
			contents = JSON.stringify(record) + "\n";
		}
		writeFileSync(layout.journalPath, contents);
		const before = readFileSync(layout.journalPath);
		assert.throws(() => openJournal(layout.journalPath, lease.assertOwned));
		assert.deepEqual(readFileSync(layout.journalPath), before);
		lease.release();
	});
}

test("failed partial append poisons writer and leaves evidence for recovery", t => {
	const { layout, lease } = storage(t);
	const journal = openJournal(layout.journalPath, lease.assertOwned, {
		writeAll(fd, bytes) { writeSync(fd, bytes.subarray(0, 10)); throw new Error("injected disk failure"); },
		sync: fsyncSync,
	});
	assert.throws(() => journal.append({ event: 1 }), /injected/);
	assert.equal(journal.readAll().length, 0);
	assert.throws(() => journal.append({ event: 2 }), /uncertain writes/);
	journal.close();
	assert.throws(() => openJournal(layout.journalPath, lease.assertOwned), /Incomplete/);
	lease.release();
});

test("sync failure is not acknowledged even if bytes were written", t => {
	const { layout, lease } = storage(t);
	const journal = openJournal(layout.journalPath, lease.assertOwned, {
		writeAll,
		sync() { throw new Error("injected sync failure"); },
	});
	assert.throws(() => journal.append({ event: 1 }), /sync failure/);
	assert.equal(journal.readAll().length, 0);
	assert.throws(() => journal.append({ event: 1 }), /uncertain/);
	journal.close(); lease.release();
});

test("journal rejects symlinks, hard links, and writable path replacement", t => {
	const { layout, lease } = storage(t);
	const journal = openJournal(layout.journalPath, lease.assertOwned);
	journal.append({ event: 1 }); journal.close();
	const backup = join(layout.runRoot, "backup");
	renameSync(layout.journalPath, backup);
	symlinkSync(backup, layout.journalPath);
	assert.throws(() => openJournal(layout.journalPath, lease.assertOwned));
	rmSync(layout.journalPath); linkSync(backup, layout.journalPath);
	assert.throws(() => openJournal(layout.journalPath, lease.assertOwned), /single-link/);
	rmSync(layout.journalPath); renameSync(backup, layout.journalPath);
	const writer = openJournal(layout.journalPath, lease.assertOwned);
	renameSync(layout.journalPath, backup);
	writeFileSync(layout.journalPath, "", { mode: 0o600 });
	assert.throws(() => writer.append({ event: 2 }), /replaced/);
	writer.close(); lease.release();
});

test("journal detects concurrent append and unsafe permission changes", t => {
	const { layout, lease } = storage(t);
	const journal = openJournal(layout.journalPath, lease.assertOwned);
	journal.append({ event: 1 });
	appendFileSync(layout.journalPath, "unexpected");
	assert.throws(() => journal.append({ event: 2 }), /outside its writer/);
	journal.close();
	chmodSync(layout.journalPath, 0o644);
	if (process.platform !== "win32") assert.throws(() => openJournal(layout.journalPath, lease.assertOwned), /private/);
	lease.release();
});

test('Windows storage branch needs neither getuid nor directory fsync', t => {
 const root = repository(t);
 const platform = Object.getOwnPropertyDescriptor(process, 'platform');
 const getuid = process.getuid;
 Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
 process.getuid = undefined;
 try {
  const directory = join(root, 'windows-profile-state');
  privateDirectory(directory);
  const lease = acquireLease({ ...prepareLayout(root, 'portable', { agentDir: directory }), ownerSessionId: 'owner' });
  lease.release();
 } finally {
  Object.defineProperty(process, 'platform', platform);
  process.getuid = getuid;
 }
});

test('state creation refuses aliased ancestors before writing outside its layout', t => {
 const root = repository(t); mkdirSync(join(root, 'outside'));
 symlinkSync(join(root, 'outside'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
 assert.throws(() => privateDirectory(join(root, 'alias', 'sessions', 'swarm')), /ancestry/);
 assert.equal(existsSync(join(root, 'outside', 'sessions')), false);
});

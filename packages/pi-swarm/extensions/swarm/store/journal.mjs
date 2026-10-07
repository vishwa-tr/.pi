import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { checkedFile, invariant, syncDirectory, writeAll } from "./files.mjs";
import { closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";

function digest(sequence, previous, payload) {
	return createHash("sha256").update(JSON.stringify({ sequence, previous, payload })).digest("hex");
}

export function openJournal(path, assertOwned, io = { writeAll, sync: fsyncSync }) {
	assertOwned();
	let created = false;
	let fd;
	try {
		fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
		created = true;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW);
	}
	let records = [];
	let expectedSize;
	let expectedStamp;
	let poisoned = false;
	let closed = false;
	try {
		const file = checkedFile(fd);
		assertJournalPath(path, file);
		expectedSize = file.size;
		if (created) { fsyncSync(fd); syncDirectory(dirname(path)); }
		const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(fd));
		invariant(text.length === 0 || text.endsWith("\n"), "Incomplete journal record; reconciliation required");
		let previous = null;
		for (const line of text.split("\n").slice(0, -1)) {
			const record = JSON.parse(line);
			invariant(Object.keys(record).sort().join() === "hash,payload,previous,sequence,version", "Invalid journal envelope");
			invariant(record.version === 1 && record.sequence === records.length + 1, "Invalid journal sequence/version");
			invariant(record.previous === previous, "Broken journal chain");
			invariant(record.hash === digest(record.sequence, previous, record.payload), "Journal checksum mismatch");
			records.push(record);
			previous = record.hash;
		}
		expectedStamp = fstatSync(fd, { bigint: true });
	} catch (error) {
		closeSync(fd);
		throw error;
	}

	return {
		readAll() { return structuredClone(records.map(record => record.payload)); },
		append(payload) {
			invariant(!closed && !poisoned, "Journal is closed or has uncertain writes");
			assertOwned();
			const current = checkedFile(fd);
			assertJournalPath(path, current);
			invariant(current.size === expectedSize, "Journal changed outside its writer");
			const stamp = fstatSync(fd, { bigint: true });
			invariant(stamp.mtimeNs === expectedStamp.mtimeNs && stamp.ctimeNs === expectedStamp.ctimeNs, "Journal metadata changed outside its writer");
			const copy = JSON.parse(JSON.stringify(payload));
			const sequence = records.length + 1;
			const previous = records.at(-1)?.hash ?? null;
			const record = { version: 1, sequence, previous, payload: copy, hash: digest(sequence, previous, copy) };
			const bytes = Buffer.from(JSON.stringify(record) + "\n");
			try {
				io.writeAll(fd, bytes);
				io.sync(fd);
				expectedStamp = fstatSync(fd, { bigint: true });
			} catch (error) {
				// The caller cannot know whether the event reached stable storage.
				// Do not retry it on this handle or acknowledge dependent work.
				poisoned = true;
				throw error;
			}
			expectedSize += bytes.length;
			records.push(record);
			return sequence;
		},
		close() {
			if (!closed) { closeSync(fd); closed = true; }
		},
	};
}

/** O_NOFOLLOW is not enforced on every platform. Validate the opened path before IO. */
function assertJournalPath(path, file) {
	const current = lstatSync(path);
	invariant(current.isFile() && !current.isSymbolicLink() && current.dev === file.dev && current.ino === file.ino, "Journal path was aliased or replaced");
}

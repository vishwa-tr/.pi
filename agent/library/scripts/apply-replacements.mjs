#!/usr/bin/env node
/**
 * Apply exact-string edits using Node 18+; no dependencies.
 * Usage: node apply-replacements.mjs <target-file> <pairs-file> [--dry-run] [--backup]
 *
 * Pairs are UTF-8 text with these markers alone on their lines:
 * <<<<OLD
 * old text
 * ====
 * new text
 * >>>>
 * Repeat blocks; notes outside blocks are ignored. For deletion put a blank line
 * between ==== and >>>>. Marker lines are reserved and cannot appear in text.
 * Each nonempty OLD must occur exactly once in the ORIGINAL target. Edits must
 * not overlap; inserted text is never an anchor for another edit.
 *
 * Targets must be regular, single-link UTF-8 text files (optional BOM). Symlinks,
 * NUL bytes, invalid UTF-8, and mixed LF/CRLF endings are rejected without writes.
 * Uniform LF/CRLF and the BOM are preserved; pairs may use either ending.
 * --dry-run validates without writing. --backup creates target-file.bak exclusively
 * with original bytes; an existing path (including a symlink) aborts the operation.
 *
 * Writes use a private sibling temporary directory and rename over the target.
 * Read/write/execute permissions are preserved, but special mode bits, inode,
 * timestamps, ownership, ACLs and extended attributes are not. A backup may
 * remain (possibly incomplete on write failure) if the operation fails. Requires a
 * filesystem with atomic same-directory rename; not a power-loss durability
 * guarantee. Do not run with concurrent writers or in an untrusted directory:
 * a pre-rename change check is best effort, not a filesystem compare-and-swap.
 * Exit codes: 0 success, 1 invalid input or I/O failure.
 * Tests: node --test scripts/apply-replacements.test.mjs (from repository root).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const OPEN = "<<<<OLD";
const SEPARATOR = "====";
const CLOSE = ">>>>";

function fail(message) {
    throw new Error(message);
}

function decode(bytes, label) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        fail(`${label}: invalid UTF-8.`);
    }
    if (text.includes("\0")) fail(`${label}: NUL bytes are not supported.`);
    return text;
}

function parsePairs(source) {
    let pairs = [];
    let oldLines = [];
    let newLines = [];
    let state = "notes";
    for (let line of source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n")) {
        if (line === OPEN) {
            if (state !== "notes") fail("Nested OLD marker.");
            oldLines = [];
            newLines = [];
            state = "old";
        } else if (line === SEPARATOR) {
            if (state !== "old") fail("Unexpected separator marker.");
            state = "new";
        } else if (line === CLOSE) {
            if (state !== "new" || newLines.length === 0) fail("Malformed closing marker.");
            let oldText = oldLines.join("\n");
            if (!oldText) fail("OLD text must not be empty.");
            pairs.push({ oldText, newText: newLines.join("\n") });
            state = "notes";
        } else if (state === "old") {
            oldLines.push(line);
        } else if (state === "new") {
            newLines.push(line);
        }
    }
    if (state !== "notes") fail("Unterminated replacement block.");
    if (!pairs.length) fail("No replacement blocks found.");
    return pairs;
}

function applyPairs(document, pairs) {
    let edits = pairs.map(({ oldText, newText }, index) => {
        let start = document.indexOf(oldText);
        if (start < 0 || document.indexOf(oldText, start + 1) !== -1) {
            fail(`Pair ${index + 1}: OLD must match exactly once in the original target.`);
        }
        return { start, end: start + oldText.length, newText, number: index + 1 };
    }).sort((left, right) => left.start - right.start);

    let cursor = 0;
    let chunks = [];
    for (let edit of edits) {
        if (edit.start < cursor) fail(`Pair ${edit.number}: overlapping edits.`);
        chunks.push(document.slice(cursor, edit.start), edit.newText);
        cursor = edit.end;
    }
    chunks.push(document.slice(cursor));
    return chunks.join("");
}

function checkTarget(targetPath) {
    let stat = fs.lstatSync(targetPath);
    if (!stat.isFile() || stat.nlink !== 1) fail("Target must be a regular, single-link file, not a symlink.");
    return stat;
}

function writeAtomic(targetPath, original, output, stat, backup) {
    let directory = fs.mkdtempSync(path.join(path.dirname(targetPath), ".apply-replacements-"));
    let temporary = path.join(directory, "output");
    try {
        fs.writeFileSync(temporary, output, { flag: "wx", mode: 0o600 });
        fs.chmodSync(temporary, stat.mode & 0o777);
        let current = checkTarget(targetPath);
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.mode !== stat.mode ||
            !fs.readFileSync(targetPath).equals(original)) {
            fail("Target changed during validation; refusing to overwrite it.");
        }
        if (backup) {
            // Exclusive creation refuses existing files, hard links, and dangling symlinks.
            fs.writeFileSync(`${targetPath}.bak`, original, { flag: "wx", mode: 0o600 });
        }
        fs.renameSync(temporary, targetPath);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

function main() {
    let args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
        let source = fs.readFileSync(new URL(import.meta.url), "utf8");
        console.log(source.slice(source.indexOf("/**") + 3, source.indexOf("*/")).replace(/^ \* ?/gm, "").trim());
        return;
    }
    let positional = args.filter((arg) => !arg.startsWith("--"));
    let flags = args.filter((arg) => arg.startsWith("--"));
    if (positional.length !== 2 || flags.some((flag) => !["--dry-run", "--backup"].includes(flag))) {
        fail("Usage: node apply-replacements.mjs <target-file> <pairs-file> [--dry-run] [--backup]");
    }
    let [targetPath, pairsPath] = positional.map((name) => path.resolve(name));
    let stat = checkTarget(targetPath);
    let original = fs.readFileSync(targetPath);
    let text = decode(original, "Target");
    let hasCrlf = text.includes("\r\n");
    let normalized = text.replace(/\r\n/g, "\n");
    if (hasCrlf && text.replace(/\r\n/g, "").includes("\n")) {
        fail("Mixed LF/CRLF target endings are not supported.");
    }
    let pairs = parsePairs(decode(fs.readFileSync(pairsPath), "Pairs"));
    let document = applyPairs(normalized, pairs);
    let output = Buffer.from(hasCrlf ? document.replace(/\n/g, "\r\n") : document, "utf8");
    let dryRun = flags.includes("--dry-run");
    if (!dryRun) writeAtomic(targetPath, original, output, stat, flags.includes("--backup"));
    console.log(`${dryRun ? "Would apply" : "Applied"} ${pairs.length} replacement(s).`);
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}

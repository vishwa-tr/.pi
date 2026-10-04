import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../agent/library/scripts/apply-replacements.mjs", import.meta.url));
const pair = (oldText, newText) => `<<<<OLD\n${oldText}\n====\n${newText}\n>>>>\n`;

function fixture(t, content, replacements) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "replacements-test-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, "target");
    const pairs = path.join(directory, "pairs");
    fs.writeFileSync(target, content);
    fs.writeFileSync(pairs, replacements);
    return {
        directory, target, pairs,
        run: (...args) => spawnSync(process.execPath, [script, target, pairs, ...args], { encoding: "utf8" }),
        read: () => fs.readFileSync(target),
    };
}

for (const [name, content, replacements] of [
    ["missing anchor after valid pair", "abc", pair("a", "A") + pair("z", "Z")],
    ["overlapping occurrences", "aaa", pair("aa", "x")],
    ["overlapping pairs", "abc", pair("ab", "x") + pair("bc", "y")],
    ["nested pairs", "abc", pair("abc", "x") + pair("b", "y")],
    ["inserted anchors", "abc", pair("a", "x") + pair("x", "y")],
    ["missing close", "abc", "<<<<OLD\na\n====\nx"],
    ["partial close", "abc", "<<<<OLD\na\n====\nx\n>>>>oops"],
    ["inline open", "abc", "note <<<<OLD\na\n====\nx\n>>>>"],
    ["empty anchor", "abc", pair("", "x")],
    ["duplicate separator", "abc", pair("a", "x\n====\ny")],
    ["mixed endings", "a\r\nb\nc", pair("a", "A")],
    ["invalid UTF-8", Buffer.from([97, 255]), pair("a", "A")],
    ["UTF-16", Buffer.from("abc", "utf16le"), pair("a", "A")],
]) {
    test(`rejects ${name} without writes or backup`, (t) => {
        const f = fixture(t, content, replacements);
        const before = f.read();
        const result = f.run("--backup");
        assert.equal(result.status, 1, result.stderr);
        assert.deepEqual(f.read(), before);
        assert.deepEqual(fs.readdirSync(f.directory).sort(), ["pairs", "target"]);
        assert.doesNotMatch(result.stdout, /Applied/);
    });
}

test("matches original text; supports adjacent edits, deletion and literal replacement tokens", (t) => {
    const f = fixture(t, "abc def", pair("ab", "def") + pair("c", "") + pair("def", "$&$`$'"));
    assert.equal(f.run().status, 0);
    assert.equal(f.read().toString(), "def $&$`$'");
});

for (const ending of ["\n", "\r\n"]) {
    test(`preserves BOM, Unicode, ${JSON.stringify(ending)}, and missing final newline`, (t) => {
        const content = `\uFEFFé${ending}old${ending}tail`;
        const f = fixture(t, content, pair("old\ntail", "new\ntail").replace(/\n/g, "\r\n"));
        assert.equal(f.run("--backup").status, 0);
        assert.equal(f.read().toString(), content.replace("old", "new"));
        assert.deepEqual(fs.readFileSync(`${f.target}.bak`), Buffer.from(content));
    });
}

test("dry run writes nothing, including backup", (t) => {
    const f = fixture(t, "a", pair("a", "b"));
    assert.equal(f.run("--dry-run", "--backup").status, 0);
    assert.equal(f.read().toString(), "a");
    assert.deepEqual(fs.readdirSync(f.directory).sort(), ["pairs", "target"]);
});

for (const kind of ["file", "symlink", "dangling", "hardlink"]) {
    test(`refuses existing ${kind} backup`, (t) => {
        const f = fixture(t, "a", pair("a", "b"));
        const backup = `${f.target}.bak`;
        if (kind === "file") fs.writeFileSync(backup, "keep");
        if (kind === "symlink") fs.symlinkSync(f.target, backup);
        if (kind === "dangling") fs.symlinkSync(path.join(f.directory, "absent"), backup);
        if (kind === "hardlink") fs.linkSync(f.target, backup);
        assert.equal(f.run("--backup").status, 1);
        assert.equal(f.read().toString(), "a");
        if (kind === "file") assert.equal(fs.readFileSync(backup, "utf8"), "keep");
        assert.ok(!fs.readdirSync(f.directory).some((name) => name.startsWith(".apply-")));
    });
}

test("refuses target symlinks", (t) => {
    const f = fixture(t, "a", pair("a", "b"));
    const real = path.join(f.directory, "real");
    fs.renameSync(f.target, real);
    fs.symlinkSync(real, f.target);
    assert.equal(f.run().status, 1);
    assert.ok(fs.lstatSync(f.target).isSymbolicLink());
    assert.equal(fs.readFileSync(real, "utf8"), "a");
});

test("rejects extra arguments and invalid pairs encoding", (t) => {
    const f = fixture(t, "a", pair("a", "b"));
    assert.equal(f.run("extra").status, 1);
    assert.equal(f.run("--unknown").status, 1);
    fs.writeFileSync(f.pairs, Buffer.from([255]));
    assert.equal(f.run().status, 1);
    assert.equal(f.read().toString(), "a");
});

test("atomic rename preserves permissions and leaves an open original descriptor intact", (t) => {
    const f = fixture(t, "a", pair("a", "b"));
    fs.chmodSync(f.target, 0o640);
    const descriptor = fs.openSync(f.target, "r");
    try {
        assert.equal(f.run().status, 0);
        assert.equal(f.read().toString(), "b");
        assert.equal(fs.readFileSync(descriptor, "utf8"), "a");
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o640);
    } finally {
        fs.closeSync(descriptor);
    }
});

for (const operation of ["writeFileSync", "renameSync"]) {
    test(`injected ${operation} failure leaves original intact and cleans temporary files`, (t) => {
        const f = fixture(t, "a", pair("a", "b"));
        const preload = path.join(f.directory, "failure.cjs");
        fs.writeFileSync(preload, `const fs = require('node:fs'); fs.${operation} = () => { throw new Error('injected failure'); };`);
        const result = spawnSync(process.execPath, ["--require", preload, script, f.target, f.pairs], { encoding: "utf8" });
        assert.equal(result.status, 1);
        assert.equal(f.read().toString(), "a");
        assert.doesNotMatch(result.stdout, /Applied/);
        assert.ok(!fs.readdirSync(f.directory).some((name) => name.startsWith(".apply-")));
    });
}

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { invariant, privateDirectory, validId } from "./files.mjs";

export function prepareLayout(workspace, runId) {
	invariant(validId(runId), "Invalid run identifier");
	const requestedRoot = realpathSync(workspace);
	const git = (...args) => execFileSync("git", ["-C", requestedRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const root = realpathSync(git("rev-parse", "--show-toplevel").trim());
	invariant(root === requestedRoot, "Workspace must be the canonical checkout root");
	invariant(git("ls-files", "-z", "--", ".swarms").length === 0, "Runtime state must not be tracked");
	// Fail before creating anything. Setup belongs to the user-facing launch flow.
	git("check-ignore", "-q", "--", ".swarms/");
	git("check-ignore", "-q", "--", ".swarms/probe/events.jsonl");
	const stateRoot = join(root, ".swarms");
	privateDirectory(stateRoot);
	return {
		workspaceRoot: root,
		stateRoot,
		runId,
		runRoot: join(stateRoot, runId),
		reservationPath: join(stateRoot, "reservation.json"),
		ownerPath: join(stateRoot, "controller.lock"),
		journalPath: join(stateRoot, runId, "events.jsonl"),
	};
}

import { requireCondition as check } from "./errors.mjs";

export function validateApproval(approval, expectedAction, existing = []) {
	check(approval && Object.keys(approval).sort().join() === "action,existingChanges,id,specificationFingerprint,workspaceFingerprint", "INPUT", "Invalid approval record");
	check(typeof approval.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(approval.id) && !existing.some(item => item.id === approval.id), "DUPLICATE", "Invalid or reused approval identifier");
	check(approval.action === expectedAction && ["launch", "resume", "restart"].includes(expectedAction), "AUTHORITY", "Approval does not match requested action");
	check(["clean", "preserve"].includes(approval.existingChanges), "AUTHORITY", "Existing-work decision required");
	for (const name of ["workspaceFingerprint", "specificationFingerprint"]) check(typeof approval[name] === "string" && /^[a-f0-9]{64}$/.test(approval[name]), "INPUT", "Invalid approval fingerprint");
}

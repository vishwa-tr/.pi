import { requireCondition as check } from "./errors.mjs";
import { validateProviderDescriptor } from "./provider-capability.mjs";

export function validateApproval(approval, expectedAction, existing = []) {
	const fields = approval?.provider === undefined
		? "action,existingChanges,id,specificationFingerprint,workspaceFingerprint"
		: "action,existingChanges,id,provider,specificationFingerprint,workspaceFingerprint";
	check(approval && Object.keys(approval).sort().join() === fields, "INPUT", "Invalid approval record");
	if (approval.provider !== undefined) validateProviderDescriptor(approval.provider);
	const previous = existing.at(-1)?.provider;
	if (previous) {
		check(approval.provider && Object.keys(previous).every(key => JSON.stringify(previous[key]) === JSON.stringify(approval.provider[key])),
			"PROVIDER", "Continuation cannot remove or replace the provider agreement");
	}
	check(typeof approval.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(approval.id) && !existing.some(item => item.id === approval.id), "DUPLICATE", "Invalid or reused approval identifier");
	check(approval.action === expectedAction && ["launch", "resume", "restart"].includes(expectedAction), "AUTHORITY", "Approval does not match requested action");
	check(["clean", "preserve"].includes(approval.existingChanges), "AUTHORITY", "Existing-work decision required");
	for (const name of ["workspaceFingerprint", "specificationFingerprint"]) check(typeof approval[name] === "string" && /^[a-f0-9]{64}$/.test(approval[name]), "INPUT", "Invalid approval fingerprint");
}

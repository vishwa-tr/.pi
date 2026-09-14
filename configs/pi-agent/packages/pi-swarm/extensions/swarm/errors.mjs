export class SwarmError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "SwarmError";
		this.code = code;
	}
}

export function requireCondition(condition, code, message) {
	if (!condition) throw new SwarmError(code, message);
}

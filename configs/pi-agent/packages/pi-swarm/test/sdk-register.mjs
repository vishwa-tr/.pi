// Test-only installed-SDK resolver. Production code imports public package roots normally.
import { existsSync } from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sdkDir = process.env.PI_SDK_DIR ?? "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent";
const manifest = resolve(sdkDir, "package.json");
if (!existsSync(manifest)) throw new Error("Installed Pi SDK missing; set PI_SDK_DIR to its package directory");
if (!process.execArgv.includes("--experimental-import-meta-resolve")) {
	throw new Error("SDK tests require --experimental-import-meta-resolve");
}
const parent = pathToFileURL(manifest).href;
const roots = {};
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "typebox"]) {
	roots[name] = import.meta.resolve(name, parent);
}
const source = `
const roots = ${JSON.stringify(roots)};
export async function resolve(specifier, context, nextResolve) {
	if (Object.hasOwn(roots, specifier)) return {url: roots[specifier], shortCircuit: true};
	return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(source)}`, import.meta.url);

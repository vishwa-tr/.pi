// Test-only resolution of installed public SDK roots; no install or runtime activation.
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.execArgv.includes("--experimental-import-meta-resolve")) {
	throw new Error("Safety tests require --experimental-import-meta-resolve");
}
const sdkDir = process.env.PI_SDK_DIR ?? "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent";
const parent = pathToFileURL(resolve(sdkDir, "package.json")).href;
const roots = {};
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
	roots[name] = import.meta.resolve(name, parent);
}
const source = `
const roots = ${JSON.stringify(roots)};
export async function resolve(specifier, context, nextResolve) {
	if (Object.hasOwn(roots, specifier)) return { url: roots[specifier], shortCircuit: true };
	return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(source)}`, import.meta.url);

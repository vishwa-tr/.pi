import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

function findPiPackage(source: NodeJS.ProcessEnv = process.env): string {
	const home = source.HOME?.trim();
	const appData = source.APPDATA?.trim();
	const packagePath = join("@earendil-works", "pi-coding-agent");
	const candidates = [
		source.PI_SDK_DIR?.trim(),
		home ? join(home, ".local", "lib", "node_modules", packagePath) : undefined,
		appData ? join(appData, "npm", "node_modules", packagePath) : undefined,
		join("/usr/local/lib/node_modules", packagePath),
		join("/usr/lib/node_modules", packagePath),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "dist", "index.js"))) return candidate;
	}
	throw new Error("@earendil-works/pi-coding-agent not found; install Pi globally or set PI_SDK_DIR");
}

const piPackage = findPiPackage();
const jitiUrl = pathToFileURL(join(piPackage, "node_modules", "jiti", "lib", "jiti.mjs"));
const { createJiti } = await import(jitiUrl.href);
const codingAgentStub = fileURLToPath(new URL("./fixtures/pi-coding-agent.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, {
	interopDefault: true,
	moduleCache: true,
	alias: {
		"@earendil-works/pi-coding-agent": codingAgentStub,
		"@earendil-works/pi-ai": join(piPackage, "node_modules", "@earendil-works", "pi-ai", "dist", "index.js"),
		"@earendil-works/pi-tui": join(piPackage, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js"),
		typebox: join(piPackage, "node_modules", "typebox", "build", "index.mjs"),
	},
});

test("discovers a Windows npm-global Pi installation without HOME", (t) => {
	const appData = mkdtempSync(join(tmpdir(), "pi-web-search-appdata-test-"));
	t.after(() => rmSync(appData, { recursive: true, force: true }));
	const expected = join(appData, "npm", "node_modules", "@earendil-works", "pi-coding-agent");
	mkdirSync(join(expected, "dist"), { recursive: true });
	writeFileSync(join(expected, "dist", "index.js"), "");

	assert.equal(findPiPackage({ APPDATA: appData }), expected);
});

test("loads the extension and wires compact transcript rendering", async () => {
	const extension = await jiti.import(
		resolve("configs/pi-agent/packages/pi-codex-web-search/extensions/codex-web-search/index.ts"),
	) as { default: (pi: { registerTool(tool: unknown): void }) => void };
	const tools: any[] = [];
	extension.default({
		registerTool(tool) {
			tools.push(tool);
		},
	});

	assert.equal(tools.length, 1);
	const tool = tools[0];
	assert.equal(tool.name, "web_search");
	assert.equal(typeof tool.renderCall, "function");
	assert.equal(typeof tool.renderResult, "function");

	const theme = {
		fg(_color: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
	const call = tool.renderCall({ query: "current release" }, theme, { expanded: false });
	assert.match(call.render(100).join("\n"), /Query: current release/);

	const result = tool.renderResult(
		{
			content: [{ type: "text", text: "answer" }],
			details: {
				query: "current release",
				sources: [{
					title: "Docs",
					url: "https://docs.example.com/release",
					provenance: "retrieved",
				}],
			},
		},
		{ expanded: false, isPartial: false },
		theme,
		{ isError: false, state: {} },
	);
	const rendered = result.render(100).join("\n");
	assert.match(rendered, /✓ Completed · 1 source/);
	assert.match(rendered, /docs\.example\.com/);
	assert.match(rendered, /https:\/\/docs\.example\.com\/release/);
	assert.ok(result.render(32).every((line: string) => Array.from(line).length <= 32));

	const failureState = {};
	tool.renderResult(
		{
			content: [{ type: "text", text: "Codex completed 1 web search…" }],
			details: {
				query: "current release",
				sources: [{
					title: "Docs",
					url: "https://docs.example.com/release",
					provenance: "retrieved",
				}],
			},
		},
		{ expanded: false, isPartial: true },
		theme,
		{ isError: false, state: failureState },
	);
	const failed = tool.renderResult(
		{ content: [{ type: "text", text: "Codex app-server exited unexpectedly" }] },
		{ expanded: false, isPartial: false },
		theme,
		{ isError: true, state: failureState },
	).render(100).join("\n");
	assert.match(failed, /✗ Failed/);
	assert.match(failed, /docs\.example\.com/);
	assert.match(failed, /https:\/\/docs\.example\.com\/release/);
});

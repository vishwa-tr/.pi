import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { X509Certificate } from "node:crypto";
import { providerDescriptor } from "./provider-capability.mjs";

const authorizations = new WeakMap();
const transports = new WeakMap();
const failure = () => new Error("Constrained HTTPS transport denied");
function requireValid(value) { if (!value) throw failure(); }

// Deliberately IPv4-only and conservative. Reject special-use, private, link-local,
// documentation, multicast and reserved networks, including mixed DNS answers.
export function isPublicIPv4(address) {
	if (net.isIP(address) !== 4) return false;
	const [a, b, c] = address.split(".").map(Number);
	return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
		(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

function authorize(capability, options, loopback) {
	const descriptor = providerDescriptor(capability);
	requireValid(descriptor.transport === "https-chat-completions" && options?.allowNetwork === true &&
		options.endpoint === descriptor.endpoint && options.modelId === descriptor.modelId);
	const allowed = loopback ? "allowNetwork,ca,endpoint,modelId" : "allowNetwork,endpoint,modelId";
	requireValid(Object.keys(options).sort().join() === allowed);
	const url = new URL(descriptor.endpoint);
	if (loopback) {
		requireValid(["localhost", "127.0.0.1"].includes(url.hostname) && url.port && typeof options.ca === "string" && options.ca.length < 65536);
		const root = new X509Certificate(options.ca);
		requireValid(root.ca && root.verify(root.publicKey) && Date.parse(root.validFrom) <= Date.now() && Date.parse(root.validTo) > Date.now());
		tls.createSecureContext({ ca: options.ca });
	} else {
		requireValid(url.hostname !== "localhost" && (!net.isIP(url.hostname) || isPublicIPv4(url.hostname)) && !url.hostname.includes(":"));
	}
	const authorization = Object.freeze({});
	authorizations.set(authorization, { capability, descriptor, loopback, ca: loopback ? options.ca : [...tls.rootCertificates] });
	return authorization;
}

/** Trusted host attestation of explicit egress permission, separate from run approval. */
export function authorizeHttpsEgress(capability, options) { return authorize(capability, options, false); }

/** Separate explicit test policy: exact localhost/127.0.0.1 endpoint and supplied CA only. */
export function authorizeLoopbackHttpsTest(capability, options) { return authorize(capability, options, true); }

/** No DNS, credential lookup or connection until a bound runtime dispatches. */
export function createHttpsTransport(options) {
	requireValid(options && Object.keys(options).sort().join() === "authorization,capability");
	const { capability, authorization } = options;
	const policy = authorizations.get(authorization);
	requireValid(policy && policy.capability === capability);
	const transport = Object.freeze({});
	transports.set(transport, { policy, requests: new WeakMap() });
	return transport;
}

export function isHttpsTransport(transport, capability) {
	return Boolean(transports.has(transport) && transports.get(transport).policy.capability === capability);
}

// Only branded transports participate in the settlement contract. Never call an
// arbitrary response.close/settled property supplied by an offline callback.
export async function settleHttpsRequest(transport, request) {
	const operation = transports.get(transport)?.requests.get(request);
	if (operation) { operation.cancel(); await operation.settled; }
}

export function dispatchHttpsRequest(transport, request, admission) {
	const state = transports.get(transport);
	requireValid(state && !state.requests.has(request));
	let cancel = () => {};
	let settled;
	const operation = { cancel: () => cancel(), settled: new Promise(resolve => { settled = resolve; }) };
	state.requests.set(request, operation);
	return (async () => {
		let client;
		let response;
		let socket;
		let requestClosed = false;
		let socketClosed = false;
		let finishClose;
		const closed = new Promise(resolve => { finishClose = resolve; });
		const checkClose = () => { if (requestClosed && (!socket || socketClosed)) finishClose(); };
		cancel = () => { response?.destroy(); client?.destroy(); };
		try {
			const { policy } = state;
			const { descriptor } = policy;
			requireValid(request.url === descriptor.endpoint && request.method === "POST" && request.redirect === "error" && request.retries === 0 &&
				Object.keys(request.headers).sort().join() === "accept,authorization,content-type" &&
				request.headers.accept === "text/event-stream" && request.headers["content-type"] === "application/json" &&
				/^Bearer [\x21-\x7e]{1,4096}$/.test(request.headers.authorization) &&
				Buffer.byteLength(request.body) <= 4 * 1024 * 1024 && JSON.parse(request.body).model === descriptor.modelId);
			request.signal.throwIfAborted(); admission.check();
			const url = new URL(descriptor.endpoint);
			const addresses = policy.loopback ? [{ address: "127.0.0.1", family: 4 }] :
				await lookup(url.hostname, { family: 4, all: true, verbatim: true });
			requireValid(addresses.length && addresses.every(item => item.family === 4 && (policy.loopback || isPublicIPv4(item.address))));
			const address = addresses[0].address;
			// Recheck after DNS and immediately before creating the one permitted request.
			admission.check(); request.signal.throwIfAborted();
			const agent = new https.Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0 });
			try {
				const received = new Promise((resolve, reject) => {
					client = https.request({ protocol: "https:", hostname: url.hostname, port: url.port || 443,
						path: url.pathname, method: "POST", agent, headers: { ...request.headers, "content-length": Buffer.byteLength(request.body), connection: "close" },
						lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
						family: 4, autoSelectFamily: false, servername: net.isIP(url.hostname) ? "" : url.hostname,
						ca: policy.ca, rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 16384,
					}, value => { response = value; resolve({ status: value.statusCode, contentType: value.headers["content-type"], body: value }); });
					client.on("error", reject);
					client.once("socket", value => {
						socket = value;
						value.once("close", () => { socketClosed = true; checkClose(); });
					});
					client.once("close", () => { requestClosed = true; checkClose(); });
					request.signal.addEventListener("abort", cancel, { once: true });
					if (request.signal.aborted) cancel();
					client.end(request.body);
				});
				// Keep resource ownership after headers, until actual client/socket close.
				void closed.then(() => { request.signal.removeEventListener("abort", cancel); agent.destroy(); settled(); });
				return await received;
			} catch {
				cancel();
				if (client) await closed;
				agent.destroy();
				throw failure();
			}
		} catch {
			settled();
			throw failure();
		}
	})();
}

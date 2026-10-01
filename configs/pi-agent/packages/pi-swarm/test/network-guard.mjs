import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";

// Defense in depth for this test process, not a production OS/network sandbox.
export function guardNetwork(t, { loopbackPort } = {}) {
	let attempts = 0;
	const sockets = new Set();
	const deny = () => { attempts++; throw new Error("Offline test blocked network access"); };
	const originals = [];
	const targets = [[globalThis, "fetch"], [net.Socket.prototype, "connect"], [tls, "connect"],
		[http, "request"], [http, "get"], [https, "request"], [https, "get"],
		[dgram.Socket.prototype, "connect"], [dgram.Socket.prototype, "send"]];
	for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
		for (const key of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname",
			"resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"]) {
			if (typeof object[key] === "function") targets.push([object, key]);
		}
	}
	for (const [object, key] of targets) {
		originals.push([object, key, object[key]]);
		const original = object[key];
		const permittedClient = loopbackPort && ((object === https && key === "request") ||
			(object === tls && key === "connect") || (object === net.Socket.prototype && key === "connect"));
		object[key] = permittedClient ? function (...args) {
			const options = Array.isArray(args[0]) ? args[0][0] : args[0];
			const host = options?.hostname ?? options?.host;
			if (!options || !["localhost", "127.0.0.1"].includes(host) || Number(options.port) !== loopbackPort || options.path && object !== https) {
				return deny();
			}
			if (object === net.Socket.prototype && host === "localhost") {
				if (typeof options.lookup !== "function") return deny();
				const lookup = options.lookup;
				options.lookup = (name, flags, callback) => lookup(name, flags, (error, address, family) => {
					const addresses = Array.isArray(address) ? address.map(item => item.address) : [address];
					if (!error && addresses.some(value => value !== "127.0.0.1")) return deny();
					callback(error, address, family);
				});
			}
			if (object === net.Socket.prototype) {
				sockets.add(this);
				this.once("close", () => sockets.delete(this));
			}
			return original.apply(this, args);
		} : deny;
	}
	syncBuiltinESMExports();
	t.after(() => {
		for (const [object, key, original] of originals) object[key] = original;
		syncBuiltinESMExports();
		assert.equal(attempts, 0, "No forbidden network access was attempted");
		assert.equal(sockets.size, 0, "All permitted client sockets actually closed");
	});
	return { sockets };
}

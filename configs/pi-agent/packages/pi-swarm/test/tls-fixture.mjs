import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";

// TEST ONLY: minimal DER encoder for ephemeral RSA/SHA-256 X.509 fixtures.
// No parser, general ASN.1 API, persisted keys, real identities or external tooling.
function der(tag, ...parts) {
	const bytes = Buffer.concat(parts.map(part => Buffer.from(part)));
	const length = bytes.length < 128 ? Buffer.from([bytes.length]) : (() => {
		const hex = bytes.length.toString(16).padStart(Math.ceil(bytes.length.toString(16).length / 2) * 2, "0");
		const value = Buffer.from(hex, "hex");
		return Buffer.concat([Buffer.from([0x80 | value.length]), value]);
	})();
	return Buffer.concat([Buffer.from([tag]), length, bytes]);
}
const sequence = (...parts) => der(0x30, ...parts);
const oid = hex => der(0x06, Buffer.from(hex, "hex"));
const algorithm = () => sequence(oid("2a864886f70d01010b"), der(0x05)); // sha256WithRSAEncryption
const name = value => sequence(der(0x31, sequence(oid("550403"), der(0x0c, Buffer.from(value)))));
const extension = (id, value, critical = false) => sequence(oid(id), ...(critical ? [der(0x01, [0xff])] : []), der(0x04, value));
function time(value) {
	const encoded = value.toISOString().replace(/[-:T]/g, "").replace(/\.\d{3}Z$/, "Z");
	// RFC 5280 requires UTCTime through 2049, GeneralizedTime thereafter.
	return value.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(encoded.slice(2))) : der(0x18, Buffer.from(encoded));
}
function certificate(publicKey, signer, subject, issuer, extensions) {
	const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] |= 1;
	const body = sequence(der(0xa0, der(0x02, [2])), der(0x02, serial), algorithm(), name(issuer),
		sequence(time(new Date(Date.now() - 60000)), time(new Date(Date.now() + 3600000))), name(subject),
		publicKey.export({ type: "spki", format: "der" }), der(0xa3, sequence(...extensions)));
	const signed = sequence(body, algorithm(), der(0x03, [0], sign("sha256", body, signer)));
	return `-----BEGIN CERTIFICATE-----\n${signed.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
}

export function ephemeralTlsFixture({ mismatch = false } = {}) {
	const caKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const serverKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const ca = certificate(caKeys.publicKey, caKeys.privateKey, "Fixture CA", "Fixture CA", [
		extension("551d13", sequence(der(0x01, [0xff]), der(0x02, [0])), true),
		extension("551d0f", der(0x03, [1, 0x06]), true),
	]);
	const dnsName = mismatch ? "mismatch.invalid" : "localhost";
	const san = [der(0x82, Buffer.from(dnsName))];
	if (!mismatch) san.push(der(0x87, [127, 0, 0, 1]));
	const cert = certificate(serverKeys.publicKey, caKeys.privateKey, "Fixture server", "Fixture CA", [
		extension("551d13", sequence(), true),
		extension("551d0f", der(0x03, [5, 0xa0]), true),
		extension("551d25", sequence(oid("2b06010505070301"))), // serverAuth
		extension("551d11", sequence(...san)),
	]);
	const root = new X509Certificate(ca);
	const leaf = new X509Certificate(cert);
	assert.equal(root.ca, true); assert.equal(leaf.ca, false);
	assert.ok(Date.parse(leaf.validFrom) <= Date.now() && Date.parse(leaf.validTo) > Date.now());
	assert.ok(root.verify(caKeys.publicKey)); assert.ok(leaf.verify(root.publicKey));
	assert.ok(leaf.checkIssued(root)); assert.ok(leaf.checkPrivateKey(serverKeys.privateKey));
	assert.equal(leaf.checkHost(dnsName), dnsName);
	assert.equal(leaf.checkIP("127.0.0.1"), mismatch ? undefined : "127.0.0.1");
	return { ca, cert, key: serverKeys.privateKey.export({ type: "pkcs8", format: "pem" }) };
}

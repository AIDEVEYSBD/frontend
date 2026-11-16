import { createServer, type Server } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Google IAP sign-in: the assertion is believed only when it is IAP's, for
 * this deployment, in date and signed with ES256; and a person gets the role
 * the deployment's mapping gives them, never more.
 */

const AUD = "/projects/123/global/backendServices/456";
let server: Server;
let sign: (claims: Record<string, unknown>, opts?: { alg?: string; iss?: string; aud?: string; exp?: number; iat?: number }) => Promise<string>;
let verifyIap: typeof import("@/lib/server/auth").verifyIap;
let iapRoles: typeof import("@/lib/server/auth").iapRoles;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  process.env.IAP_JWKS_URL = `http://127.0.0.1:${port}/keys`;
  process.env.IAP_AUDIENCE = AUD;
  process.env.AUTH_SECRET = "test-secret";
  const now = Math.floor(Date.now() / 1000);
  sign = (claims, o = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: o.alg ?? "ES256", kid: "k1" })
      .setIssuer(o.iss ?? "https://cloud.google.com/iap")
      .setAudience(o.aud ?? AUD)
      .setIssuedAt(o.iat ?? now)
      .setExpirationTime(o.exp ?? now + 300)
      .sign(privateKey);
  ({ verifyIap, iapRoles } = await import("@/lib/server/auth"));
});

afterAll(() => {
  server?.close();
});

describe("an IAP assertion", () => {
  it("names the person when it is IAP's, for this deployment and in date", async () => {
    const who = await verifyIap(await sign({ sub: "accounts.google.com:42", email: "Alice@Example.com", hd: "example.com" }));
    expect(who).toEqual({ sub: "accounts.google.com:42", email: "alice@example.com", domain: "example.com" });
  });
  it("is refused when it was signed for another service", async () => {
    await expect(verifyIap(await sign({ sub: "s" }, { aud: "/projects/123/global/backendServices/999" }))).rejects.toThrow();
  });
  it("is refused when the issuer is not IAP", async () => {
    await expect(verifyIap(await sign({ sub: "s" }, { iss: "https://accounts.google.com" }))).rejects.toThrow();
  });
  it("is refused once it has expired past the allowed skew", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyIap(await sign({ sub: "s" }, { iat: now - 900, exp: now - 120 }))).rejects.toThrow();
  });
  it("is refused when it names nobody", async () => {
    await expect(verifyIap(await sign({ email: "a@example.com" }))).rejects.toThrow(/no subject/);
  });
  it("is refused when it is not a signed token at all", async () => {
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "https://cloud.google.com/iap", aud: AUD, sub: "s", exp: 9999999999 })).toString("base64url")}.`;
    await expect(verifyIap(unsigned)).rejects.toThrow();
    await expect(verifyIap("not-a-token")).rejects.toThrow();
  });
});

describe("roles for a person IAP signed in", () => {
  it("come from the deployment's mapping: the address first, then its domain", () => {
    process.env.IAP_ROLE_MAP = JSON.stringify({ "alice@example.com": "administrator", "@example.com": ["operator"], " Bob@Other.org ": "viewer" });
    expect(iapRoles("alice@example.com")).toEqual(["administrator"]);
    expect(iapRoles("carol@example.com")).toEqual(["operator"]);
    expect(iapRoles("bob@other.org")).toEqual(["viewer"]);
  });
  it("are none for someone the mapping does not name, so the default role applies", () => {
    process.env.IAP_ROLE_MAP = JSON.stringify({ "@example.com": "operator" });
    expect(iapRoles("mallory@elsewhere.net")).toEqual([]);
    expect(iapRoles("")).toEqual([]);
  });
  it("are none when the mapping is not valid, never more", () => {
    process.env.IAP_ROLE_MAP = "{not json";
    expect(iapRoles("alice@example.com")).toEqual([]);
    process.env.IAP_ROLE_MAP = JSON.stringify(["administrator"]);
    expect(iapRoles("alice@example.com")).toEqual([]);
  });
});

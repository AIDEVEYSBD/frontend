import * as oidc from "openid-client";
import { POST_LOGOUT_URL, authEvent, clearSessionCookie, provider, session, ssoEnabled } from "@/lib/server/auth";
import { SESSION_COOKIE, readCookie, readSessionCookie } from "@/lib/auth-cookie";
import { dbReady, query } from "@/lib/server/db";

/**
 * Sign out: the session row goes, the cookie is cleared, and the page is
 * handed the identity provider's end-session URL, built with the ID token
 * from sign-in so the provider knows which client is asking and brings the
 * person back to the console afterwards.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!ssoEnabled()) return Response.json({ redirect: "/", note: "sign-in is not configured; nothing to sign out of" });
  const s = await session(req);
  const cookie = await readSessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE), process.env.AUTH_SECRET ?? "");
  let endSession = POST_LOGOUT_URL;
  if (cookie && (await dbReady())) {
    const [row] = await query<{ id_token: string }>("SELECT id_token FROM sessions WHERE id = $1", [cookie.id]);
    await query("DELETE FROM sessions WHERE id = $1", [cookie.id]);
    if (row?.id_token) {
      try {
        const cfg = await provider();
        endSession = oidc.buildEndSessionUrl(cfg, { id_token_hint: row.id_token, post_logout_redirect_uri: POST_LOGOUT_URL, state: oidc.randomState() }).href;
      } catch {
        /* the provider is unreachable; the local session is gone regardless */
      }
    }
  }
  if (s) await authEvent("sign_out", s.sub, s.email || null);
  return Response.json({ redirect: endSession }, { headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}

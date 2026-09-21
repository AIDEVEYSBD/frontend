import { dbReady, query } from "@/lib/server/db";
import { permit } from "@/lib/server/auth";

/**
 * Console appearance, kept on the server so it holds across browsers and
 * people: one settings row, read by every page on load. Changing it needs
 * the configure permission and is written to the audit trail like any other
 * configuration change.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface UiSettings { accent: boolean }
const DEFAULT: UiSettings = { accent: true };

async function read(): Promise<UiSettings> {
  if (!(await dbReady())) return DEFAULT;
  const rows = await query<{ value: Partial<UiSettings> }>("SELECT value FROM settings WHERE key = 'ui'");
  return { ...DEFAULT, ...(rows[0]?.value ?? {}) };
}

export async function GET() {
  return Response.json(await read(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: Partial<UiSettings>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected {accent: true|false}" }, { status: 400 });
  }
  if (typeof body.accent !== "boolean") return Response.json({ error: "send accent: true or false" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const next = { ...(await read()), accent: body.accent };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('ui', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return Response.json(next);
}

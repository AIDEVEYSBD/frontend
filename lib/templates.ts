import { isPlatformAdmin } from "./permissions";
import { samePerson, type Access } from "./mcp-registry";
import { shortDigest, whenText, type Reviewer } from "./lifecycle";
import type { CutRequest, Lineage, TemplateView } from "./api/l8b";

/**
 * Templates and lineage as the console says them (phase L8, second round).
 * A template is one saved version's document, `pending` until a certifier
 * who is not its author signs it (`TEMPLATE_CERTIFIER_ROLE`, default
 * `template-certifier`; an administrator passes the role, never the
 * separation of duties). An agent is cut from a certified template only,
 * its `${param:name}` references filled; the cut records its lineage, and
 * the lineage door answers the drift since in the spec's vocabulary. The
 * backend decides each of these again (403 `separation_of_duties` naming
 * the authors, 403 `missing_role`, 409 `template_certification`, 400 naming
 * the param); these say it in a person's words or stop a click before it
 * gets that far. Pure: components/templates.tsx and components/lifecycle.tsx
 * render these, tests/l8b-logic.test.ts and tests/l8b-contract.test.ts hold
 * them.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TEMPLATE_STATE_META: Record<string, { label: string; tone: "warn" | "ok" | "neutral"; means: string }> = {
  pending: { label: "pending", tone: "warn", means: "waiting for a certifier who did not author it" },
  certified: { label: "certified", tone: "ok", means: "signed by a certifier; agents may be cut from it" },
};

export const templateStateMeta = (state: string) => TEMPLATE_STATE_META[state] ?? { label: state.replace(/_/g, " "), tone: "neutral" as const, means: "" };

/* ═══════════════════ params ═══════════════════ */

/** One param a template takes: its default, or required when it has none. */
export interface ParamField {
  name: string;
  /** `${param:name|default}`'s default, or null: a cut must give a value. */
  default: string | null;
  required: boolean;
}

/** The params a template takes, required ones first, each group by name. */
export function paramFields(params: Record<string, string | null>): ParamField[] {
  return Object.entries(params)
    .map(([name, d]) => ({ name, default: d, required: d === null }))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
}

/** The params in a line: `unit (required), title (default "Triage")`; "no params" for none. */
export function paramsLine(params: Record<string, string | null>): string {
  const f = paramFields(params);
  if (!f.length) return "no params";
  return f.map((p) => (p.required ? `${p.name} (required)` : `${p.name} (default "${p.default}")`)).join(", ");
}

/* ═══════════════════ the cut ═══════════════════ */

/** The cut form: the new agent's id, and a value per param (empty leaves a default in place). */
export interface CutForm {
  id: string;
  values: Record<string, string>;
}

/** The backend's rule for a new agent's id. */
export const AGENT_ID = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * What the backend would refuse before anything is sent: an id that is not
 * one (400 `field: id`), one that exists (409 `field: id`), a template not
 * certified (409 `control: template_certification`), a required param left
 * empty (400 `field: params`, `missing`).
 */
export function cutProblem(t: Pick<TemplateView, "state" | "params" | "name">, f: CutForm, existing: readonly string[]): string {
  if (t.state !== "certified") return `"${t.name}" is ${t.state}: an agent is cut from a certified template only`;
  const id = f.id.trim();
  if (!id) return "name the new agent: its id";
  if (!AGENT_ID.test(id)) return "the id is lowercase letters, digits and dashes, starting with a letter";
  if (existing.includes(id)) return `"${id}" exists: a cut is a new agent, under a new id`;
  const missing = paramFields(t.params).filter((p) => p.required && !(f.values[p.name] ?? "").trim()).map((p) => p.name);
  if (missing.length) return `the template needs ${missing.join(", ")}`;
  return "";
}

/** The request the cut makes: only the params the template takes, and only those given (an empty one keeps its default). */
export function cutBody(templateId: string, f: CutForm, params: Record<string, string | null>): CutRequest {
  const given: Record<string, unknown> = {};
  for (const name of Object.keys(params)) {
    const v = (f.values[name] ?? "").trim();
    if (v) given[name] = v;
  }
  return { from_template: templateId, id: f.id.trim(), ...(Object.keys(given).length ? { params: given } : {}) };
}

/* ═══════════════════ certification ═══════════════════ */

/**
 * Whether this person may certify a template: not one of its authors
 * (whoever made it and whoever saved a version carrying its digest;
 * administrator or not), and holding the certifier role (or an
 * administrator). The approve permission is the button's own check.
 */
export function certifyAccess(who: Reviewer | null, authors: readonly string[], role: string): Access {
  if (!who) return { ok: false, reason: "who you are is not known yet" };
  const mine = authors.find((a) => samePerson(a, who));
  if (mine) return { ok: false, reason: `you are an author of this template (${mine}); another certifier must sign` };
  if (isPlatformAdmin(who.appRoles)) return { ok: true, reason: "" };
  // The platform names the roles that may certify as one comma-separated line; with none named, the platform decides on the press.
  const roles = role.split(",").map((r) => r.trim()).filter(Boolean);
  if (!roles.length) return { ok: true, reason: "" };
  const held = new Set([...(who.roles ?? []), ...(who.appRoles ?? []), ...(who.groups ?? [])]);
  if (roles.some((r) => held.has(r))) return { ok: true, reason: "" };
  return { ok: false, reason: `certifying a template needs one of these roles: ${roles.join(", ")} (or an administrator); yours: ${[...held].join(", ") || "none"}` };
}

/** A refusal of the templates door or of a cut, in a person's words. */
export function templateRefusalText(e: { status: number; message: string; field?: string; control?: string; missingRole?: string; body: Record<string, unknown> }): string {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  if (e.status === 403 && e.control === "separation_of_duties") {
    const authors = list(e.body.authors);
    return `Separation of duties${authors.length ? ` (authors: ${authors.join(", ")})` : ""}: ${e.message}`;
  }
  if (e.status === 403 && e.missingRole) return `Needs the "${e.missingRole}" role: ${e.message}`;
  if (e.status === 409 && e.control === "template_certification") return `The template is ${String(e.body.state ?? "not certified")}: ${e.message}`;
  if (e.status === 409 && e.field === "id") return `${e.message}. Pick another id.`;
  if (e.status === 409 && typeof e.body.state === "string") return `${e.message}: a template is certified once.`;
  if (e.status === 400 && e.field === "params") {
    const missing = list(e.body.missing);
    const takes = list(e.body.takes);
    return `The template needs ${missing.join(", ") || "more params"}${takes.length ? ` (it takes: ${takes.join(", ")})` : ""}.`;
  }
  if (e.status === 400 && e.field?.startsWith("params.")) {
    const takes = list(e.body.takes);
    return `The template takes no param "${e.field.slice(7)}"${takes.length ? `; it takes: ${takes.join(", ")}` : ""}.`;
  }
  return e.message;
}

/* ═══════════════════ in a line ═══════════════════ */

/** Where a template came from, and its state. */
export function templateLine(t: TemplateView): string {
  const params = Object.keys(t.params).length;
  return `Made by ${t.by || "someone"} ${whenText(t.at)} from ${t.agent} version ${t.version ?? "?"} (${shortDigest(t.digest)}) · ${plural(params, "param")} · ${templateStateMeta(t.state).label}`;
}

/** A template's certification in a line, or "" for none. */
export function certifiedLine(t: Pick<TemplateView, "certified">): string {
  if (!t.certified) return "";
  return `Certified by ${t.certified.by}${t.certified.at ? ` ${whenText(t.certified.at)}` : ""}${t.certified.note ? `: ${t.certified.note}` : ""}`;
}

/** The params a cut filled, in a line. */
export function cutParamsLine(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (!entries.length) return "no params";
  return entries.map(([k, v]) => `${k} = ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
}

/** An agent's lineage in a line: the template, the cut, where it stands now. */
export function lineageLine(l: Lineage): string {
  const cut = `Cut by ${l.cut.by || "someone"} ${whenText(l.cut.at)} as version ${l.cut.version ?? "?"}, ${cutParamsLine(l.cut.params)}`;
  const now = l.current.version !== null && l.current.version !== l.cut.version ? ` · now version ${l.current.version} (${shortDigest(l.current.digest)})` : "";
  const deployed = l.deployed ? ` · production runs version ${l.deployed.version ?? "?"}` : " · not deployed";
  return `${cut}${now}${deployed}`;
}

/** The drift in a line: what moved from the template, or that nothing the spec names has. */
export function driftLine(l: Pick<Lineage, "drifted" | "drift">): string {
  const summary = l.drift?.summary ?? [];
  if (!l.drifted || !summary.length) return "No drift from the template.";
  return `Drifted from the template: ${plural(summary.length, "change")} (${summary.join("; ")})`;
}

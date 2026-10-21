"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import { SpecDiffView } from "./versions";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { useSession } from "@/lib/use-session";
import { DoorError } from "@/lib/api/l5";
import { listAgents, listVersions, type AgentSummary, type VersionView } from "@/lib/api/l2";
import { certifyTemplate, cutAgent, getTemplate, listTemplates, makeTemplate, type AgentCut, type Lineage, type TemplateDocument, type TemplateList, type TemplateView } from "@/lib/api/l8b";
import { diffSections } from "@/lib/versions";
import { shortDigest, type Reviewer } from "@/lib/lifecycle";
import {
  certifiedLine,
  certifyAccess,
  cutBody,
  cutProblem,
  driftLine,
  lineageLine,
  paramFields,
  paramsLine,
  templateLine,
  templateRefusalText,
  templateStateMeta,
  type CutForm,
} from "@/lib/templates";

/**
 * Templates and lineage (phase L8, second round).
 *
 * A template is one saved version's document, made by someone who may
 * deploy (`POST /api/templates`), `pending` until a certifier signs it: one
 * who holds the certifier role (`TEMPLATE_CERTIFIER_ROLE`, default
 * `template-certifier`; an administrator passes the role) and is not one of
 * its authors (whoever made it, whoever saved a version carrying its digest;
 * administrator or not). An agent is cut from a certified template only
 * (`POST /api/agents {from_template, id, params}`), its `${param:name}`
 * references filled, and records its lineage. On the agent's lifecycle
 * page, the lineage shows the template, the cut and the drift since, in the
 * spec's vocabulary (components/versions.tsx's diff). The doors are the
 * backend's (lib/api/l8b.ts); the words lib/templates.ts's.
 */

const TONE: Record<string, "warn" | "ok" | "neutral"> = { warn: "warn", ok: "ok", neutral: "neutral" };

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor(title.toLowerCase())} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
        <span className="text-[12.5px] font-semibold text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/* ═══════════════════ lineage, on the agent ═══════════════════ */

/** An agent's lineage: the template, the cut, and the drift since in the spec's vocabulary. Presentational, so tests render it from a captured lineage. */
export function LineageView({ lineage }: { lineage: Lineage }) {
  const t = lineage.template;
  const meta = templateStateMeta(t.state);
  const sections = lineage.drift ? diffSections(lineage.drift) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-faint">Cut from</span>
        <Link href={`/templates?id=${encodeURIComponent(t.id)}`} className="focusable rounded-sm text-[12.5px] font-semibold text-fg underline">
          {t.name}
        </Link>
        <Status tone={TONE[meta.tone]}>{meta.label}</Status>
        <Mono className="text-[10.5px] text-dim">
          {t.id} · {shortDigest(lineage.template_digest)}
        </Mono>
        <span className="grow" />
        {lineage.drifted ? <Tag tone="warn">drifted</Tag> : <Tag tone="ok">as cut</Tag>}
      </div>
      <p className="text-[12px] leading-[1.55] text-dim">{lineageLine(lineage)}</p>
      {certifiedLine(t) && <p className="text-[11.5px] text-faint">{certifiedLine(t)}</p>}
      <p className={`text-[11.5px] ${lineage.drifted ? "text-warn" : "text-faint"}`}>{driftLine(lineage)}</p>
      <div className="overflow-hidden rounded-md border border-line">
        <SpecDiffView
          fromLabel={`template ${t.name}`}
          toLabel={`v${lineage.current.version ?? "?"}`}
          fromDigestLabel={`Template ${t.id} digest`}
          toDigestLabel={`Version ${lineage.current.version ?? "?"} digest`}
          shown={{ diff: lineage.drift, error: lineage.drift ? "" : "the backend sent no drift" }}
          sections={sections}
          quietNote="Nothing the spec's vocabulary names has moved from the template: only the agent's id differs, which its digest covers and the diff does not name."
        />
      </div>
    </div>
  );
}

/* ═══════════════════ the list and one template ═══════════════════ */

/** The templates, newest first. Presentational. */
export function TemplatesListView({ list, selected, onSelect }: { list: TemplateList; selected?: string | null; onSelect?: (id: string) => void }) {
  if (!list.templates.length)
    return <p className="text-[12px] text-faint">No template is on record. Make one from a saved version below; a certifier who did not author it signs it before any agent is cut from it.</p>;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {list.templates.map((t) => {
        const meta = templateStateMeta(t.state);
        return (
          <li key={t.id} className={`border-b border-line last:border-b-0 ${selected === t.id ? "bg-raise/50" : ""}`}>
            <button type="button" onClick={() => onSelect?.(t.id)} className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-raise/40">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-fg">{t.name}</span>
                <Status tone={TONE[meta.tone]}>{meta.label}</Status>
                <Mono className="text-[10.5px] text-faint">{t.id}</Mono>
              </span>
              <span className="text-[11px] text-dim">{templateLine(t)}</span>
              <span className="text-[10.5px] text-faint">params: {paramsLine(t.params)}</span>
              {t.certified && <span className="text-[10.5px] text-faint">{certifiedLine(t)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One template with its params and its document. Presentational. */
export function TemplateDetailView({ template }: { template: TemplateDocument }) {
  const meta = templateStateMeta(template.state);
  const fields = paramFields(template.params);
  const nodes = Array.isArray((template.spec.spec as { nodes?: unknown[] } | undefined)?.nodes) ? ((template.spec.spec as { nodes: { id?: string; label?: string }[] }).nodes ?? []) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-fg">{template.name}</span>
        <Status tone={TONE[meta.tone]}>{meta.label}</Status>
        <Mono className="text-[10.5px] text-faint">{template.id}</Mono>
      </div>
      <p className="text-[12px] leading-[1.55] text-dim">{templateLine(template)}</p>
      <p className="text-[11.5px] text-faint">{template.certified ? certifiedLine(template) : meta.means}.</p>
      <p className="text-[11px] text-faint">Authors (none of them may certify it): {template.authors.join(", ") || "none recorded"}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-dim">Params</span>
        {fields.length === 0 ? (
          <p className="text-[11.5px] text-faint">It takes no params: a cut is its document under a new id.</p>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-md border border-line text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="px-3 py-1.5 font-medium">Param</th>
                <th className="px-3 py-1.5 font-medium">A cut</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5 font-mono text-fg">{`\${param:${f.name}}`}</td>
                  <td className="px-3 py-1.5 text-dim">{f.required ? <span className="text-warn">must give a value</span> : `may leave it: "${f.default}"`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nodes.length > 0 && (
        <p className="text-[11px] text-faint">
          Its document: {nodes.length} node{nodes.length === 1 ? "" : "s"} ({nodes.map((n) => n.label || n.id).join(", ")}).
        </p>
      )}
      <details>
        <summary className="focusable cursor-pointer text-[11px] text-faint">The document, as saved</summary>
        <pre className="mt-1 max-h-72 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-faint">{JSON.stringify(template.spec, null, 2)}</pre>
      </details>
    </div>
  );
}

/* ═══════════════════ the forms ═══════════════════ */

function MakeTemplateForm({ agents, onMade }: { agents: AgentSummary[]; onMade: (t: TemplateView) => void }) {
  const [agent, setAgent] = useState("");
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!agent) return;
    let stop = false;
    listVersions(agent)
      .then((l) => {
        if (stop) return;
        setVersions(l.versions);
        setVersion(l.versions.length ? Math.max(...l.versions.map((v) => v.version)) : null);
      })
      .catch(() => !stop && setVersions([]));
    return () => {
      stop = true;
    };
  }, [agent]);
  const problem = !agent ? "pick the agent" : version === null ? "pick a saved version" : !name.trim() ? "name the template" : "";
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Make a template from a saved version</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">
        It copies that version&rsquo;s document as saved. Its <span className="font-mono">{"${param:name}"}</span> references (and <span className="font-mono">{"${param:name|default}"}</span>) are what a cut fills.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Agent">
          <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "Pick an agent" }, ...agents.map((a) => ({ value: a.id, label: `${a.name} · ${a.id}` }))]} />
        </Field>
        <Field label="Version">
          <Pick
            value={version === null ? "" : String(version)}
            onChange={(v) => setVersion(v ? Number(v) : null)}
            options={versions.length ? [...versions].sort((a, b) => b.version - a.version).map((v) => ({ value: String(v.version), label: `version ${v.version} · ${shortDigest(v.digest)}` })) : [{ value: "", label: agent ? "No saved version" : "Pick an agent first" }]}
          />
        </Field>
        <Field label="Name" error={tried && !name.trim() ? "Name the template." : undefined}>
          <Input value={name} onChange={setName} placeholder="Triage, certified" />
        </Field>
      </div>
      {tried && problem && <span className="text-[11px] text-err">{problem}</span>}
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="ink"
          permission="deploy"
          loading={busy}
          onClick={async () => {
            setTried(true);
            if (problem || version === null) return;
            setBusy(true);
            setError("");
            try {
              onMade(await makeTemplate({ from_agent: agent, version, name: name.trim() }));
              setName("");
              setTried(false);
            } catch (e) {
              setError(e instanceof DoorError ? templateRefusalText(e) : (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Make template
        </Button>
      </span>
    </div>
  );
}

function CertifyForm({ template, role, who, onDone }: { template: TemplateView; role: string; who: Reviewer | null; onDone: (t: TemplateView) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const access = certifyAccess(who, template.authors, role);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Certify</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">
        A certifier holds the &ldquo;{role}&rdquo; role (or administers) and is not an author of the template. Once certified, agents may be cut from it.
      </span>
      <Field label="Note" hint="Recorded with the certification.">
        <Textarea rows={2} value={note} onChange={setNote} disabled={busy} />
      </Field>
      {!access.ok && <span className="text-[11.5px] text-warn">{access.reason}</span>}
      {error && (
        <Banner tone="err" title="The certification was refused">
          {error}
        </Banner>
      )}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="ink"
          permission="approve"
          disabled={!access.ok}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              onDone(await certifyTemplate(template.id, note.trim() || undefined));
              setNote("");
            } catch (e) {
              setError(e instanceof DoorError ? templateRefusalText(e) : (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Certify template
        </Button>
      </span>
    </div>
  );
}

function CutAgentForm({ template, existing, onCut }: { template: TemplateView; existing: string[]; onCut: (cut: AgentCut) => void }) {
  const fields = paramFields(template.params);
  const [form, setForm] = useState<CutForm>({ id: "", values: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const problem = cutProblem(template, form, existing);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Cut an agent from it</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">The template&rsquo;s document under a new id, its params filled, saved as the new agent&rsquo;s version 1 (not deployed). The cut is recorded as the agent&rsquo;s lineage.</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="New agent id" error={tried && (problem.startsWith("the id") || problem.startsWith("name the") || problem.includes("exists")) ? problem : undefined}>
          <Input value={form.id} onChange={(v) => setForm((f) => ({ ...f, id: v }))} placeholder="triage-emea" mono />
        </Field>
        {fields.map((p) => (
          <Field key={p.name} label={`${p.name}${p.required ? "" : " (optional)"}`} hint={p.required ? "required: the template has no default" : `default "${p.default}"`} error={tried && p.required && !(form.values[p.name] ?? "").trim() ? "Give a value." : undefined}>
            <Input value={form.values[p.name] ?? ""} onChange={(v) => setForm((f) => ({ ...f, values: { ...f.values, [p.name]: v } }))} placeholder={p.default ?? ""} />
          </Field>
        ))}
      </div>
      {tried && problem && <span className="text-[11px] text-err">{problem}</span>}
      {error && (
        <Banner tone="err" title="The cut was refused">
          {error}
        </Banner>
      )}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="ink"
          permission="deploy"
          loading={busy}
          onClick={async () => {
            setTried(true);
            if (problem) return;
            setBusy(true);
            setError("");
            try {
              onCut(await cutAgent(cutBody(template.id, form, template.params)));
              setForm({ id: "", values: {} });
              setTried(false);
            } catch (e) {
              setError(e instanceof DoorError ? templateRefusalText(e) : (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Cut agent
        </Button>
      </span>
    </div>
  );
}

/* ═══════════════════ the page ═══════════════════ */

const STATE_FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "certified", label: "Certified" },
];

function TemplatesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("id");
  const { session } = useSession();
  const [state, setState] = useState("");
  const [list, setList] = useState<TemplateList | null>(null);
  const [error, setError] = useState("");
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [doc, setDoc] = useState<TemplateDocument | null>(null);
  const [docError, setDocError] = useState("");
  const [cut, setCut] = useState<AgentCut | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await listTemplates(state ? { state } : {}));
      setError("");
    } catch (e) {
      setList({ templates: [], count: 0, role: "template-certifier" });
      setError((e as Error).message);
    }
  }, [state]);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  const loadDoc = useCallback(async () => {
    if (!selected) return;
    try {
      setDoc(await getTemplate(selected));
      setDocError("");
    } catch (e) {
      setDoc(null);
      setDocError((e as Error).message);
    }
  }, [selected]);
  useEffect(() => soon(loadDoc), [loadDoc]);

  const who: Reviewer | null = session ? { name: session.name, email: session.email, sub: session.sub, roles: session.roles, appRoles: session.appRoles, groups: session.groups } : null;
  const existing = useMemo(() => agents.map((a) => a.id), [agents]);
  const shown = doc && doc.id === selected ? doc : null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7" data-hue="blue">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Templates</h1>
        <p className="max-w-[760px] text-[13.5px] leading-relaxed text-dim">
          A template is one saved version&rsquo;s document, certified by someone who did not author it. Agents are cut from certified templates only, their params filled,
          and each keeps its lineage: the template, the digest it was cut from, and how far it has drifted since.
        </p>
      </header>
      {error && (
        <Banner tone="err" title="Could not read the templates">
          {error}
        </Banner>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Section title="Templates" meta={list ? `${list.count} on record · a certifier holds the "${list.role}" role` : undefined}>
          <div className="flex items-center gap-1">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => setState(f.value)}
                aria-pressed={state === f.value}
                className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${state === f.value ? "bg-raise font-semibold text-fg" : "font-medium text-faint hover:text-dim"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {list ? <TemplatesListView list={list} selected={selected} onSelect={(id) => router.push(`/templates?id=${encodeURIComponent(id)}`)} /> : <p className="text-[12px] text-faint">Reading the templates…</p>}
          <MakeTemplateForm
            agents={agents}
            onMade={(t) => {
              void load();
              router.push(`/templates?id=${encodeURIComponent(t.id)}`);
            }}
          />
        </Section>
        <Section title="Template" meta={shown ? shown.id : selected ? "reading…" : "pick one"}>
          {!selected && <p className="text-[12px] text-faint">Pick a template to read its params and document, certify it, or cut an agent from it.</p>}
          {docError && <span className="text-[11.5px] text-err">{docError}</span>}
          {shown && (
            <>
              <TemplateDetailView template={shown} />
              {cut && (
                <Banner tone="ok" title={`Cut ${cut.id}, version ${cut.version ?? "?"}`}>
                  Saved from {shown.name}
                  {cut.lineage ? ` at digest ${shortDigest(cut.lineage.template_digest)}` : ""}; it is not deployed.{" "}
                  <Link href={`/lifecycle?agent=${encodeURIComponent(cut.id)}`} className="focusable rounded-sm font-medium text-fg underline">
                    Its lifecycle and lineage
                  </Link>
                </Banner>
              )}
              {shown.state !== "certified" ? (
                <CertifyForm
                  template={shown}
                  role={list?.role ?? "template-certifier"}
                  who={who}
                  onDone={() => {
                    void load();
                    void loadDoc();
                  }}
                />
              ) : (
                <CutAgentForm
                  template={shown}
                  existing={existing}
                  onCut={(c) => {
                    setCut(c);
                    listAgents()
                      .then(setAgents)
                      .catch(() => {});
                  }}
                />
              )}
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

export function TemplatesView() {
  return (
    <Suspense>
      <TemplatesPage />
    </Suspense>
  );
}

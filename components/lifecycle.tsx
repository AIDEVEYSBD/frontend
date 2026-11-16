"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import { DeployDialog, DeployedReceipt } from "./deploy-gate";
import { CanaryPanel } from "./canary";
import { LineageView } from "./templates";
import { AutonomyPanel } from "./autonomy";
import { getLineage, type Lineage } from "@/lib/api/l8b";
import { declaredTierLabel } from "@/lib/autonomy";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { useSession } from "@/lib/use-session";
import { DoorError } from "@/lib/api/l5";
import { listAgents, listVersions, type AgentSummary, type VersionView } from "@/lib/api/l2";
import {
  getAgentDetail,
  getBenchmark,
  getLifecycle,
  listDeployments,
  listReviews,
  retire,
  retiredOf,
  retiredRefusalOf,
  rollback,
  submitReview,
  type AgentLifecycleDetail,
  type Benchmark,
  type Deployed,
  type Deployment,
  type DeploymentList,
  type Lifecycle,
  type Retired,
  type Retirement,
  type ReviewList,
  type RollbackResult,
  type Verdict,
} from "@/lib/api/l8";
import {
  authorsOf,
  benchmarkLine,
  overrideLine,
  retireProblem,
  retiredLine,
  reviewAccess,
  reviewRefusalText,
  rollbackLine,
  rollbackProblem,
  rollbackTargets,
  shortDigest,
  spineHeadline,
  spineOf,
  verdictLabel,
  whenText,
  type Reviewer,
  type SpineStage,
} from "@/lib/lifecycle";

/**
 * An agent's lifecycle (phase L8, first round), from design to retirement,
 * each stage lit only by its own record:
 *
 *   designed  a saved version carrying the digest
 *   reviewed  an approving policy review of it by someone who did not author it
 *   approved  a promotion-gate decision that passed for it
 *   canary    a canary deployment of it (the second half of L8)
 *   deployed  a production deployment row of it
 *   retired   the agent's retirement
 *
 * The spine is drawn for one digest (the latest version's, or one picked),
 * with what production runs beside it, and where the digest stands now
 * (`current`: the furthest stage lit that still holds). Below: the
 * benchmark of what production runs; the policy reviews, and a review to
 * sign (the approve permission, the reviewer role, and never by an author of
 * the version: separation of duties); the deployments per environment; a
 * rollback to a version that ran in production before, with the runs it
 * flags; canary and shadow beside production (L8, second round:
 * components/canary.tsx); the lineage of an agent cut from a template, with
 * the drift since (components/templates.tsx); and retirement, after which
 * the agent refuses new work everywhere and its records stay readable. Every
 * door is the backend's (lib/api/l8.ts, lib/api/l8b.ts).
 */

const STAGE_TONE: Record<SpineStage["tone"], { dot: string; text: string }> = {
  ok: { dot: "border-ok bg-ok", text: "text-fg" },
  warn: { dot: "border-warn bg-warn", text: "text-fg" },
  err: { dot: "border-err bg-err", text: "text-fg" },
  neutral: { dot: "border-line-strong bg-surface", text: "text-faint" },
  // Lit by its own record, which no longer holds (a canary that ended): what happened, not where the digest stands.
  past: { dot: "border-ok bg-surface", text: "text-dim" },
};

/** The spine: six stages, lit only by their records, with who and when. Presentational, so tests render it from a captured spine. */
export function SpineView({ lifecycle }: { lifecycle: Lifecycle }) {
  const stages = spineOf(lifecycle);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-[1.55] text-dim">{spineHeadline(lifecycle)}</p>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {stages.map((st, i) => {
          const tone = STAGE_TONE[st.tone];
          return (
            <li
              key={st.stage}
              aria-current={st.now ? "step" : undefined}
              className={`flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2 ${st.now ? "border-fg bg-surface" : st.lit ? "border-line-strong bg-surface" : "border-dashed border-line bg-canvas"}`}
              title={st.lit ? (st.now ? "Where this digest stands now" : undefined) : `Dark: waiting on ${st.needs}`}
            >
              <span className="flex items-center gap-2">
                <span className={`size-2.5 shrink-0 rounded-[3px] border ${tone.dot}`} aria-hidden />
                <span className={`text-[12.5px] font-semibold ${tone.text}`}>{st.label}</span>
                {st.now && <Tag tone="ink">now</Tag>}
                <span className="grow" />
                <Mono className="text-[9.5px] text-ghost">{i + 1}</Mono>
              </span>
              {st.lit ? (
                <>
                  {st.who && <span className="text-[10.5px] leading-[1.45] text-dim">{st.who}</span>}
                  {st.note && <span className={`text-[10.5px] leading-[1.45] ${st.tone === "warn" ? "text-warn" : st.tone === "err" ? "text-err" : st.tone === "past" ? "text-dim" : "text-faint"}`}>{st.note}</span>}
                </>
              ) : (
                <span className="text-[10.5px] leading-[1.45] text-ghost">{st.note || `waiting on ${st.needs}`}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The benchmark of what production runs. Presentational. */
export function BenchmarkView({ benchmark, agent }: { benchmark: Benchmark | null; agent: string }) {
  if (!benchmark)
    return (
      <p className="text-[12px] text-faint">
        No eval of {agent} is on record. A deploy needs one on the spec&rsquo;s own suite, run by the backend:{" "}
        <Link href={`/evals?agent=${encodeURIComponent(agent)}`} className="focusable rounded-sm font-medium text-fg underline">
          run one
        </Link>
        .
      </p>
    );
  const tone = benchmark.passed_threshold === true ? "ok" : benchmark.passed_threshold === false ? "err" : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="tnum text-[18px] font-semibold text-fg">{benchmark.score !== null ? benchmark.score.toFixed(3) : "—"}</span>
      <Status tone={tone}>{benchmark.passed_threshold === true ? "at or above its threshold" : benchmark.passed_threshold === false ? "under its threshold" : "no threshold"}</Status>
      {!benchmark.matches_deployed && <Tag tone="warn">not what production runs</Tag>}
      <span className="min-w-0 text-[11.5px] text-dim">{benchmarkLine(benchmark)}</span>
      <Mono className="text-[10px] text-faint">
        {benchmark.id} · {whenText(benchmark.at)}
      </Mono>
    </div>
  );
}

/** The reviews, newest first. Presentational. */
export function ReviewsView({ list }: { list: ReviewList }) {
  if (!list.reviews.length) return <p className="text-[12px] text-faint">No policy review is on record. A reviewer holds the &ldquo;{list.role}&rdquo; role, and never reviews a version they saved.</p>;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {list.reviews.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
          <Status tone={r.verdict === "approved" ? "ok" : "warn"}>{verdictLabel(r.verdict)}</Status>
          <span className="text-[12px] font-medium text-fg">{r.by}</span>
          <Mono className="text-[10.5px] text-dim">
            {r.version !== null ? `version ${r.version}` : "a version"} · {shortDigest(r.digest)}
          </Mono>
          <span className="text-[10.5px] text-faint">{whenText(r.at)}</span>
          {r.note && <span className="w-full text-[11.5px] leading-[1.5] text-dim">{r.note}</span>}
          {r.authors.length > 0 && <span className="w-full text-[10px] text-ghost">authored by {r.authors.join(", ")}</span>}
        </li>
      ))}
    </ul>
  );
}

const ENV_ORDER = (env: string) => (env === "production" ? 0 : 1);

/** One deployment row in a line. */
function DeploymentRow({ d }: { d: Deployment }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
      <Tag tone={d.kind === "rollback" ? "warn" : "neutral"}>{d.kind}</Tag>
      <span className="text-[12px] font-medium text-fg">version {d.version ?? "?"}</span>
      <Mono className="text-[10.5px] text-dim">{shortDigest(d.digest)}</Mono>
      {d.current && <Status tone="ok">runs now</Status>}
      <span className="text-[10.5px] text-faint">
        by {d.by} · {whenText(d.at)}
      </span>
      {d.previous && <span className="text-[10.5px] text-faint">replaced version {d.previous.version ?? "?"}{d.previous.adopted ? " (deployed before deployments were recorded)" : ""}</span>}
      {d.reason && <span className="w-full text-[11.5px] text-dim">Reason: {d.reason}</span>}
      {d.override && <span className="w-full text-[11px] text-warn">{overrideLine(d.override)}</span>}
      {d.flagged.length > 0 && (
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]">
          <span className="text-faint">{d.flagged.length} run{d.flagged.length === 1 ? "" : "s"} of version {d.previous?.version ?? "?"} flagged:</span>
          {d.flagged.map((r) => (
            <Link key={r} href={`/runs?id=${encodeURIComponent(r)}`} className="focusable rounded-sm font-mono text-dim hover:underline">
              {r}
            </Link>
          ))}
        </span>
      )}
      <Mono className="w-full text-[9.5px] text-ghost">
        {d.id}
        {d.decision ? ` · decision ${d.decision}` : ""}
        {d.eval_run ? ` · eval ${d.eval_run}` : ""}
        {d.review ? ` · review ${d.review}` : ""}
      </Mono>
    </li>
  );
}

/** The deployments, per environment, what runs in each now first. Presentational. */
export function DeploymentsView({ list }: { list: DeploymentList }) {
  const envs = [...new Set([...Object.keys(list.current), ...list.deployments.map((d) => d.environment)])].sort((a, b) => ENV_ORDER(a) - ENV_ORDER(b) || a.localeCompare(b));
  return (
    <div className="flex flex-col gap-3">
      {list.adopted && (
        <Banner tone="neutral" title={`Production runs version ${list.adopted.version ?? "?"}`}>
          It was deployed before deployments were recorded, so no deployment row stands for it; the next deploy or rollback is the first.
        </Banner>
      )}
      {!envs.length && !list.adopted && <p className="text-[12px] text-faint">Never deployed. A save is what runs until the first deploy passes the promotion gate.</p>}
      {envs.map((env) => {
        const rows = list.deployments.filter((d) => d.environment === env);
        const now = list.current[env];
        return (
          <div key={env} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-fg">{env}</span>
              {now ? <Mono className="text-[10.5px] text-dim">runs version {now.version ?? "?"} ({shortDigest(now.digest)})</Mono> : <span className="text-[10.5px] text-faint">nothing current</span>}
              {env === "canary" || env === "shadow" ? (
                <span className="text-[10.5px] text-faint">
                  {env === "shadow" ? "mirrored beside production in shadow mode" : "a share of queued starts beside production"}; current only while its canary stands
                </span>
              ) : (
                env !== "production" && <span className="text-[10.5px] text-faint">recorded only: what production runs does not move</span>
              )}
            </span>
            <ul className="flex flex-col overflow-hidden rounded-md border border-line">
              {rows.map((d) => (
                <DeploymentRow key={d.id} d={d} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** A rollback's receipt: what runs again, and the runs it flagged for review. Presentational. */
export function RollbackReceipt({ r }: { r: RollbackResult }) {
  return (
    <Banner tone="warn" title={`Rolled back to version ${r.to.version ?? "?"}`}>
      {rollbackLine(r)}
      {r.flagged.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {r.flagged.map((run) => (
            <Link key={run} href={`/runs?id=${encodeURIComponent(run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-fg underline">
              {run}
            </Link>
          ))}
        </span>
      )}
      <span className="mt-0.5 block font-mono text-[10px] text-faint">
        deployment {r.deployment.id}
        {r.audit_id !== null ? ` · audit event #${r.audit_id}` : ""}
      </span>
    </Banner>
  );
}

/** A retirement wherever it is shown. Presentational. */
export function RetiredView({ retired, cancelled = [] }: { retired: Retired; cancelled?: string[] }) {
  return (
    <Banner tone="neutral" title="Retired">
      {retiredLine(retired)}
      {retired.replacement && (
        <>
          {" "}
          <Link href={`/lifecycle?agent=${encodeURIComponent(retired.replacement)}`} className="focusable rounded-sm font-medium text-fg underline">
            Its replacement, {retired.replacement}
          </Link>
          .
        </>
      )}
      {cancelled.length > 0 && <span className="mt-0.5 block text-[11px] text-faint">{cancelled.length} queued job{cancelled.length === 1 ? " was" : "s were"} cancelled with the reason.</span>}
      {retired.id && <span className="mt-0.5 block font-mono text-[10px] text-faint">retirement {retired.id}</span>}
    </Banner>
  );
}

/* ═══════════════════ the forms ═══════════════════ */

/** Versions as picker options, newest first, one per digest (two saves of the same document are one digest): the newest version that carries it. */
function versionChoices(versions: readonly VersionView[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const v of [...versions].sort((a, b) => b.version - a.version)) {
    if (!v.digest || seen.has(v.digest)) continue;
    seen.add(v.digest);
    out.push({ value: v.digest, label: `version ${v.version} · ${shortDigest(v.digest)}${v.deployed ? " · deployed" : ""}` });
  }
  return out;
}

function ReviewForm({ agent, versions, defaultDigest, role, who, onDone }: { agent: string; versions: VersionView[]; defaultDigest: string; role: string; who: Reviewer | null; onDone: () => void }) {
  const [digest, setDigest] = useState(defaultDigest);
  const [verdict, setVerdict] = useState<Verdict>("approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [seed, setSeed] = useState(defaultDigest);
  if (seed !== defaultDigest) {
    setSeed(defaultDigest);
    setDigest(defaultDigest);
  }
  const access = reviewAccess(who, authorsOf(versions, digest), role);
  const options = versionChoices(versions);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Sign a policy review</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="The version reviewed">
          <Pick value={digest} onChange={setDigest} options={options.length ? options : [{ value: digest, label: shortDigest(digest) }]} />
        </Field>
        <Field label="Verdict">
          <span className="flex h-9 items-center gap-4">
            {(["approved", "changes_requested"] as Verdict[]).map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-fg">
                <input type="radio" name={`af-verdict-${agent}`} checked={verdict === v} onChange={() => setVerdict(v)} disabled={busy} />
                {verdictLabel(v)}
              </label>
            ))}
          </span>
        </Field>
      </div>
      <Field label="Note" hint="Recorded with the review; a request for changes says what to change.">
        <Textarea rows={2} value={note} onChange={setNote} disabled={busy} />
      </Field>
      {!access.ok && <span className="text-[11.5px] text-warn">{access.reason}</span>}
      {error && (
        <Banner tone="err" title="The review was refused">
          {error}
        </Banner>
      )}
      {done && <span className="text-[11.5px] text-ok">{done}</span>}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="ink"
          permission="approve"
          disabled={!access.ok || !digest}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            setDone("");
            try {
              const r = await submitReview(agent, { digest, verdict, note: note.trim() });
              setDone(`${verdictLabel(r.verdict)} by ${r.by}, version ${r.version ?? "?"}.`);
              setNote("");
              onDone();
            } catch (e) {
              setError(e instanceof DoorError ? reviewRefusalText(e) : (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign review
        </Button>
      </span>
    </div>
  );
}

function RollbackForm({ agent, list, onDone }: { agent: string; list: DeploymentList; onDone: (r: RollbackResult) => void }) {
  const targets = rollbackTargets(list);
  const [to, setTo] = useState<number | null>(targets[0]?.version ?? null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  if (!targets.length) return <p className="text-[12px] text-faint">Nothing to roll back to: no other version has run in production.</p>;
  const problem = rollbackProblem(to, reason);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Roll back production</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">
        Reinstates a version that ran in production before, as a new deployment, without the gate (its eval is on record). Every run of the version rolled back from,
        since it was deployed, is flagged for review.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Reinstate">
          <Pick
            value={to === null ? "" : String(to)}
            onChange={(v) => setTo(v ? Number(v) : null)}
            options={targets.map((t) => ({ value: String(t.version), label: `version ${t.version} · ${shortDigest(t.digest)} · ${t.how} ${whenText(t.at)}` }))}
          />
        </Field>
        <Field label="Reason" error={tried && !reason.trim() ? "A rollback needs a reason." : undefined}>
          <Input value={reason} onChange={setReason} placeholder="What the version rolled back from got wrong" />
        </Field>
      </div>
      {tried && problem && <span className="text-[11px] text-err">{problem}</span>}
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="warn"
          permission="deploy"
          loading={busy}
          onClick={async () => {
            setTried(true);
            if (problem || to === null) return;
            setBusy(true);
            setError("");
            try {
              onDone(await rollback(agent, { to_version: to, reason: reason.trim() }));
              setReason("");
              setTried(false);
            } catch (e) {
              const gone = retiredRefusalOf(e);
              setError(gone ? `${agent} is retired. ${retiredLine(gone)}` : (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Roll back
        </Button>
      </span>
    </div>
  );
}

function RetireForm({ agent, others, onDone }: { agent: string; others: string[]; onDone: (r: Retirement) => void }) {
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const problem = retireProblem(agent, reason, replacement, others);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Retire {agent}</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">
        After it, every door that starts work for it refuses (runs, triggers, webhooks, A2A tasks, evals, deploys, rollbacks), its schedules stop and its queued jobs are
        cancelled with the reason. Its runs, versions and journals stay readable and replayable.
      </span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Reason" error={tried && !reason.trim() ? "A retirement needs a reason." : undefined}>
          <Input value={reason} onChange={setReason} placeholder="Why it no longer runs" />
        </Field>
        <Field label="Replacement (optional)">
          <Pick value={replacement} onChange={setReplacement} options={[{ value: "", label: "No replacement" }, ...others.map((o) => ({ value: o, label: o }))]} />
        </Field>
      </div>
      {tried && problem && <span className="text-[11px] text-err">{problem}</span>}
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="err"
          permission="deploy"
          loading={busy}
          onClick={async () => {
            setTried(true);
            if (problem) return;
            // One click asks; the second, within three seconds, retires.
            if (!confirm) {
              setConfirm(true);
              setTimeout(() => setConfirm(false), 3000);
              return;
            }
            setBusy(true);
            setError("");
            try {
              onDone(await retire(agent, { reason: reason.trim(), ...(replacement ? { replacement } : {}) }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
              setConfirm(false);
            }
          }}
        >
          {confirm ? "Click again to retire" : "Retire"}
        </Button>
      </span>
    </div>
  );
}

/* ═══════════════════ one agent ═══════════════════ */

function Section({ id, title, meta, children }: { id?: string; title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor(title.toLowerCase())} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
        <span className="text-[12.5px] font-semibold text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

interface Loaded {
  detail: AgentLifecycleDetail | null;
  lifecycle: Lifecycle | null;
  reviews: ReviewList | null;
  deployments: DeploymentList | null;
  benchmark: Benchmark | null;
  versions: VersionView[];
  /** An agent cut from a template: its lineage and drift; null for one made by hand. */
  lineage: Lineage | null;
  error: string;
}

function AgentLifecycle({ agent, digest }: { agent: string; digest: string | null }) {
  const router = useRouter();
  const { session } = useSession();
  const [data, setData] = useState<Loaded | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [deployAsk, setDeployAsk] = useState(false);
  const [deployed, setDeployed] = useState<Deployed | null>(null);
  const [rolled, setRolled] = useState<RollbackResult | null>(null);
  const [retirement, setRetirement] = useState<Retirement | null>(null);

  const load = useCallback(async () => {
    const [detail, lifecycle, reviews, deployments, benchmark, versions] = await Promise.allSettled([
      getAgentDetail(agent),
      getLifecycle(agent, digest ?? undefined),
      listReviews(agent),
      listDeployments(agent),
      getBenchmark(agent),
      listVersions(agent),
    ]);
    const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
    const firstError = [detail, lifecycle].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    // Only an agent cut from a template has a lineage to read.
    const lineage = val(detail)?.lineage ? await getLineage(agent).catch(() => null) : null;
    setData({
      detail: val(detail),
      lifecycle: val(lifecycle),
      reviews: val(reviews),
      deployments: val(deployments),
      benchmark: val(benchmark),
      versions: val(versions)?.versions ?? [],
      lineage,
      error: firstError ? (firstError.reason as Error).message : "",
    });
  }, [agent, digest]);

  useEffect(() => soon(load), [load]);
  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  const who: Reviewer | null = session ? { name: session.name, email: session.email, sub: session.sub, roles: session.roles, appRoles: session.appRoles, groups: session.groups } : null;
  const retired = data?.lifecycle?.retired ?? data?.detail?.retired ?? null;
  const spineDigest = data?.lifecycle?.digest ?? "";
  const versionOptions = useMemo(() => versionChoices(data?.versions ?? []), [data?.versions]);
  const others = agents.filter((a) => a.id !== agent && !retiredOf(a.retired)).map((a) => a.id);
  const latest = data?.detail?.version ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/lifecycle" className="focusable w-fit rounded-sm text-[11.5px] text-faint hover:text-fg">
            Lifecycle
          </Link>
          <span className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{data?.detail?.name ?? agent}</h1>
            <Mono className="text-[11px] text-faint">{agent}</Mono>
            {retired && <Status tone="neutral">Retired</Status>}
          </span>
          {data?.detail && (
            <span className="text-[11.5px] text-dim">
              latest save version {data.detail.version ?? "?"} ({shortDigest(data.detail.digest)}) ·{" "}
              {data.detail.deployed_version !== null ? `production runs version ${data.detail.deployed_version} (${shortDigest(data.detail.deployed_digest)})` : "nothing deployed to production"}
            </span>
          )}
        </div>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="neutral" href={`/evals?agent=${encodeURIComponent(agent)}`}>
          Evals
        </Button>
        <Button size="sm" variant="solid" tone="neutral" href={`/attestations?agent=${encodeURIComponent(agent)}`}>
          Attestations
        </Button>
        <Button size="sm" variant="solid" tone="neutral" href={`/bom?agent=${encodeURIComponent(agent)}`}>
          AI-BOM
        </Button>
        <Button size="sm" variant="solid" tone="neutral" href={`/policy?simulate=${encodeURIComponent(agent)}#simulate`}>
          Simulate policy
        </Button>
        <Button size="sm" variant="solid" tone="ink" permission="deploy" disabled={Boolean(retired) || latest === null} onClick={() => setDeployAsk(true)}>
          Deploy version {latest ?? "?"}…
        </Button>
      </header>

      {deployAsk && latest !== null && (
        <DeployDialog
          agent={agent}
          version={latest}
          label={`version ${latest} of ${agent}`}
          onClose={() => setDeployAsk(false)}
          onDeployed={(d) => {
            setDeployed(d);
            load();
          }}
        />
      )}
      {data?.error && (
        <Banner tone="err" title={`Could not read the lifecycle of ${agent}`}>
          {data.error}
        </Banner>
      )}
      {retired && <RetiredView retired={retired} cancelled={retirement?.cancelled_jobs ?? []} />}
      {deployed && !deployAsk && <DeployedReceipt d={deployed} />}

      <Section title="Spine" meta="each stage lit only by its own record">
        {versionOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-faint">Drawn for</span>
            <div className="w-80">
              <Pick
                value={spineDigest}
                onChange={(d) => router.push(`/lifecycle?agent=${encodeURIComponent(agent)}${d ? `&digest=${encodeURIComponent(d)}` : ""}`)}
                options={versionOptions}
              />
            </div>
          </div>
        )}
        {data?.lifecycle ? <SpineView lifecycle={data.lifecycle} /> : <p className="text-[12px] text-faint">{data ? "No spine to draw." : "Reading the lifecycle…"}</p>}
      </Section>

      <Section id="autonomy" title="Autonomy tier" meta="what its metadata.autonomy declares, and the controls it lacks">
        <AutonomyPanel agent={agent} tick={deployed ? 1 : 0} />
      </Section>

      <Section title="Benchmark" meta="the latest eval of what production runs, on the spec's own suite">
        {data ? <BenchmarkView benchmark={data.benchmark} agent={agent} /> : <p className="text-[12px] text-faint">Reading…</p>}
      </Section>

      <Section id="reviews" title="Policy reviews" meta={data?.reviews ? `${data.reviews.count} on record · a reviewer holds the "${data.reviews.role}" role and never reviews a version they saved` : undefined}>
        {data?.reviews && <ReviewsView list={data.reviews} />}
        {data && !retired && (
          <ReviewForm agent={agent} versions={data.versions} defaultDigest={spineDigest || data.detail?.digest || ""} role={data.reviews?.role ?? "policy-reviewer"} who={who} onDone={load} />
        )}
      </Section>

      <Section id="deployments" title="Deployments" meta="per environment; production is gated, and is what runs">
        {data?.deployments ? <DeploymentsView list={data.deployments} /> : <p className="text-[12px] text-faint">{data ? "No deployments on record." : "Reading…"}</p>}
        {rolled && <RollbackReceipt r={rolled} />}
        {data?.deployments && !retired && (
          <RollbackForm
            agent={agent}
            list={data.deployments}
            onDone={(r) => {
              setRolled(r);
              load();
            }}
          />
        )}
      </Section>

      <Section id="canary" title="Canary and shadow" meta="a version beside production: a share of starts, or a mirror in shadow mode">
        {data ? (
          <CanaryPanel agent={agent} versions={data.versions} production={data.detail?.deployed_version ?? null} retired={Boolean(retired)} onChanged={load} />
        ) : (
          <p className="text-[12px] text-faint">Reading…</p>
        )}
      </Section>

      {data?.lineage && (
        <Section id="lineage" title="Lineage" meta="the certified template it was cut from, and the drift since">
          <LineageView lineage={data.lineage} />
        </Section>
      )}

      <Section title="Retirement" meta="refuses new work everywhere; its records stay">
        {retired ? (
          <p className="text-[12px] text-faint">Retired {whenText(retired.at)}. Nothing restarts it; save its document as a new agent to carry it on.</p>
        ) : (
          <RetireForm
            agent={agent}
            others={others}
            onDone={(r) => {
              setRetirement(r);
              load();
            }}
          />
        )}
      </Section>
    </div>
  );
}

/* ═══════════════════ every agent ═══════════════════ */

/** Every agent, with where it stands: the latest save, what production runs, retired. */
export function LifecycleIndexView({ agents }: { agents: AgentSummary[] }) {
  if (!agents.length) return <p className="text-[12px] text-faint">No agent is saved yet. Build one, save it, and its lifecycle starts here.</p>;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      {agents.map((a) => {
        const retired = retiredOf(a.retired);
        const deployedV = a.deployed_version ?? null;
        return (
          <li key={a.id} className="border-b border-line last:border-b-0">
            <Link href={`/lifecycle?agent=${encodeURIComponent(a.id)}`} className="focusable flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-raise/40">
              <span className={`text-[13px] font-semibold ${retired ? "text-dim" : "text-fg"}`}>{a.name}</span>
              <Mono className="text-[10.5px] text-faint">{a.id}</Mono>
              {retired ? (
                <Status tone="neutral">Retired</Status>
              ) : deployedV !== null ? (
                <Status tone="ok">Production runs version {deployedV}</Status>
              ) : (
                <Status tone="queue">Not deployed</Status>
              )}
              {!retired && a.version !== null && a.version !== undefined && deployedV !== null && a.version !== deployedV && <Tag tone="warn">draft version {a.version}</Tag>}
              {!retired && <Tag>{declaredTierLabel(a.autonomy)}</Tag>}
              <span className="grow" />
              {retired && <span className="text-[11px] text-faint">{retired.reason}{retired.replacement ? ` · replaced by ${retired.replacement}` : ""}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function LifecycleIndex() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch((e: Error) => {
        setAgents([]);
        setError(e.message);
      });
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Lifecycle</h1>
        <p className="max-w-[720px] text-[13.5px] leading-relaxed text-dim">
          Each agent from design to retirement: designed, reviewed, approved, canary, deployed, retired, every stage lit only by its own record. A deploy to production
          passes the promotion gate on those records, or an administrator&rsquo;s override with a reason.
        </p>
      </header>
      {error && (
        <Banner tone="err" title="Could not read the registry">
          {error}
        </Banner>
      )}
      {agents === null ? <p className="text-[12px] text-faint">Reading the registry…</p> : <LifecycleIndexView agents={agents} />}
    </div>
  );
}

function LifecyclePage() {
  const params = useSearchParams();
  const agent = params.get("agent");
  const digest = params.get("digest");
  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="blue">
      {agent ? <AgentLifecycle key={`${agent}:${digest ?? ""}`} agent={agent} digest={digest} /> : <LifecycleIndex />}
    </div>
  );
}

export function LifecycleView() {
  return (
    <Suspense>
      <LifecyclePage />
    </Suspense>
  );
}

"use client";
import { ask, type Answer } from "@/lib/api/pending";
import { errorText } from "@/lib/api/client";
import { Failure, AnswerFailure, NotBuiltValue } from "./pending";
import { notBuilt, notBuiltOf } from "@/lib/not-built";

import { VertexDetected, useVertex } from "./vertex-detected";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { usePageFacts } from "./assistant";
import { GroupHeader } from "./page-tabs";
import { MCP_ENDPOINT } from "@/lib/site";
import { hueFor } from "@/lib/hue";
import { CONNECTOR_DEFS } from "@/lib/connections";
import { AttachedAgents } from "./attached-agents";
import { ToolServers } from "./tool-servers";
import { useMcp } from "@/lib/use-mcp";
import { STATUS_META } from "@/lib/mcp-registry";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import type { AttachedAgent } from "@/lib/attached";
import { JOB_STATUS_META, queueTotals } from "@/lib/queue";
import { Providers, useConfigChanges } from "./providers";
import { Keys, OfferedModels } from "./settings";
import { ModelClearance } from "./model-clearance";
import { ApiKeys } from "./api-keys";
import { PeerList, meOf, usePeers } from "./peers";
import { useSession } from "@/lib/use-session";
import { Appearance } from "./appearance";
import { peerCounts } from "@/lib/peers";

/**
 * Configuration: everything this deployment is set up with, in one place.
 *
 * The page answers "what is wired, what does it reach, and who signs". It
 * shows only what exists on this deployment: the connections the saved
 * workflows configure (read from their documents by /api/configuration,
 * with usage counted from the run journals), the registered tool servers,
 * the attached agents, the peers, the providers and the models offered, the
 * vault's keys and the ingress keys. Nothing here comes from a catalogue: a
 * deployment with no workflow shows no connection, and a read that fails
 * shows an error and no rows.
 *
 * The panels sit on five tabs (TABS below; the tab row is the
 * `configuration` group of lib/page-groups.ts, drawn by GroupHeader), and
 * the address carries the open one as `?tab=`. Every tab stays mounted, so
 * a panel keeps what it read, and a form half filled in, while another tab
 * is looked at; only the open tab is shown.
 *
 * Most panels are read. Four are where their subject is managed, and each
 * reads and writes its own door: Providers and Models (components/
 * providers.tsx, components/settings.tsx), Credentials (the vault) and Peers
 * (components/peers.tsx). Appearance is the console's own setting. The old
 * Settings and Peers pages are these panels; their addresses redirect here.
 *
 * A panel is addressed by its id after `#`, which opens its tab, opens the
 * panel and brings it into view; `#peer-<id>` is one row of Peers.
 *
 * A tab on which something is not connected (a quiet console, lib/quiet.ts,
 * with nothing behind it) says so once, in one note under the header, and
 * draws each such panel open in its empty form: its headings, its columns
 * and one line saying what it holds.
 *
 * A figure appears only when it was measured. A connection that is
 * configured and never called says "never called"; there is no health or
 * last-sync figure, because nothing measures one.
 */

interface Source {
  name: string;
  kind: string;
  tool: string;
  server: string;
  slot: string;
  agent: string;
  agentName: string;
  node: string;
  taints: boolean;
  sink: boolean;
  risk: string;
  calls: number;
  lastUsed: string | null;
  settings: string[];
  usesVault: boolean;
}

interface Data {
  deployment: {
    registry: string;
    gateway: string;
    endpoint: string;
    runs: number;
    workflows: number;
    deployed: number;
    egress: string[];
    /** Null when there is no billing feed (`billing` is then in `not_built`). */
    billing: boolean | null;
    /** Where this service is set to send requests: a description, not an allowlist that refuses other hosts. */
    outbound?: string[];
  };
  /** A price is null when none is set: "not priced", never $0. */
  models: { id: string; label: string; class?: string; price_in?: number | null; price_out?: number | null }[];
  defaultModel: string;
  classDefaults: Record<string, string>;
  sources: Source[];
  /** The tool registry as the platform answers it; read through `registeredToolOf`, so a missing field never throws. */
  tools: unknown[];
  gates: { agent: string; agentName: string; atOrAbove: string; approvers: string[] }[];
  vaultKeys: string[];
  apiKeys: { name: string; agent: string | null; prefix: string; last_used: string | null; revoked_at: string | null }[];
  queue: Record<string, number>;
  /** The fields whose feature is not built (`tools`, `sources`, `vaultKeys`, `egress`, `billing`): their lists are empty because nothing could fill them. */
  not_built?: string[];
  basis: string;
  /** False only when the console has nothing behind it: no database, no backend, no runtime files (app/api/configuration/route.ts). */
  connected?: boolean;
}

/**
 * One row of the tool registry panel: a tool a deployed workflow names, beside
 * what the platform registered about it (agentfactory api/routes/modelsettings.py
 * `_tools`): the registered risk, the definition's declared risk and the
 * effective risk the policy gates on (the higher of the two), whether it acts
 * outside and whether what it returns is untrusted, its calls. `registered`
 * false: no tool of that name is registered, and a run is refused it. Fields
 * the answer does not carry (`repeatable`) read "not stated".
 */
interface RegisteredTool {
  name: string;
  /** "builtin", the id of the approved tool server it comes from, or "" when the answer does not say. */
  server: string;
  description: string;
  /** The risk it is registered at; "" when not registered or not said. */
  risk: string;
  declaredRisk: string;
  effectiveRisk: string;
  /** null when the answer does not say. */
  registered: boolean | null;
  sink: boolean;
  untrusted: boolean;
  /** null when the answer does not say. */
  repeatable: boolean | null;
  agent: string;
  agentName: string;
  calls: number | null;
  lastUsed: string | null;
}

/** A row of `tools[]`, read defensively: a missing field is empty or "not stated", never a crash. */
function registeredToolOf(v: unknown): RegisteredTool | null {
  const t = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!t) return null;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const name = s(t.tool) || s(t.name);
  if (!name) return null;
  return {
    name,
    server: s(t.server),
    description: s(t.summary) || s(t.description),
    risk: s(t.risk),
    declaredRisk: s(t.declared_risk),
    effectiveRisk: s(t.effective_risk) || s(t.risk),
    registered: typeof t.registered === "boolean" ? t.registered : null,
    sink: t.sink === true || t.is_sink === true,
    untrusted: t.taints === true || t.untrusted === true,
    repeatable: typeof t.repeatable === "boolean" ? t.repeatable : null,
    agent: s(t.agent),
    agentName: s(t.agentName) || s(t.agent),
    calls: typeof t.calls === "number" ? t.calls : null,
    lastUsed: s(t.lastUsed) || s(t.last_used) || null,
  };
}

type TabId = "models" | "tools" | "connections" | "access" | "deployment";

/** The five tabs: the panels each holds, in order, and one sentence on it. The row itself, with each tab's label and address, is in lib/page-groups.ts. */
const TABS: { id: TabId; panels: string[]; about: string }[] = [
  {
    id: "models",
    panels: ["vertex", "providers", "models"],
    about: "The model endpoints this deployment was set up with, and which models teams may pick from; the offered models and their prices are managed here.",
  },
  {
    id: "tools",
    panels: ["registry", "tools", "mcp"],
    about: "The tool servers registered here, every tool a workflow can be given, and this deployment's own MCP server.",
  },
  {
    id: "connections",
    panels: ["sources", "peers", "agents", "egress"],
    about: "What the workflows connect to and who this deployment talks to: sources, peers, outside agents and allowed hosts.",
  },
  {
    id: "access",
    panels: ["credentials", "ingress", "gates"],
    about: "The vault's credentials (by name; a value is never shown), the keys that may post work here, and where a person has to sign.",
  },
  {
    id: "deployment",
    panels: ["deployment", "appearance"],
    about: "Where this deployment keeps its records, and how the console looks.",
  },
];

/** Each panel's heading, by its id (the id is also its address after `#`). */
const TITLES: Record<string, string> = {
  vertex: "Detected on Google Vertex AI",
  providers: "Providers",
  models: "Models",
  registry: "Tool servers",
  tools: "Tool registry",
  mcp: "Agent Factory as an MCP server",
  sources: "Connected sources",
  peers: "Peers",
  agents: "Third-party agents",
  egress: "Egress allowlist",
  credentials: "Credentials",
  ingress: "Ingress",
  gates: "Where a person signs",
  deployment: "Deployment",
  appearance: "Appearance",
};

/** The tab that holds a panel. */
function tabOf(panel: string): TabId {
  return TABS.find((t) => t.panels.includes(panel))?.id ?? "models";
}

/** What an address names after `#`: the element to bring into view, and the panel that holds it. A row of Peers is `peer-<id>`. */
function hashTarget(): { id: string; panel: string } | null {
  let id = window.location.hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* as written */
  }
  if (Object.hasOwn(TITLES, id)) return { id, panel: id };
  if (id.startsWith("peer-")) return { id, panel: "peers" };
  return null;
}


/**
 * The platform's own tools that reach outside an agent's reasoning, by the
 * name the platform gives them: what each is, and its mode. They are told
 * apart by tool name first, so the row reads right whatever kind the answer
 * gives them.
 */
const PLATFORM_SOURCES: Record<string, { label: string; blurb: string; mode: SourceMode }> = {
  "dataset.read": { label: "Dataset", blurb: "A file handed over: an uploaded dataset the run's input names", mode: "offline" },
  "retrieval.search": { label: "Knowledge store", blurb: "The platform's own knowledge store: the documents admitted to it, searched when the run asks", mode: "platform" },
  "web.fetch": { label: "Web fetch", blurb: "Pages read from the web when the run asks, from the hosts this deployment allows", mode: "live" },
  "notify.send": { label: "Webhooks", blurb: "Messages sent when the run asks, to the hosts this deployment allows", mode: "live" },
};

/**
 * Whether a source is offline, live or the platform's own store, from its
 * tool when it is one of the platform's (above), else from its kind (7.4): a
 * file or a folder handed over is offline; a connection read when the run
 * asks is live (a tool on a tool server among them); the knowledge store is
 * neither. A kind this table does not know is read from what it configures
 * (a path or a root against a URL or a DSN), and is not stated otherwise.
 */
type SourceMode = "offline" | "live" | "platform";
const OFFLINE_KINDS = new Set(["file", "folder", "documents", "images", "dataset"]);
const LIVE_KINDS = new Set(["vector", "tavily", "tool", "mcp", "tool_server", "postgres", "rest", "sql", "db", "http", "web", "git", "a2a", "slack", "smtp", "webhook", "events"]);
const PLATFORM_KINDS = new Set(["knowledge"]);
function modeOf(s: { kind?: string; tool?: string; server?: string; settings?: string[] }): SourceMode | null {
  const builtin = s.tool ? PLATFORM_SOURCES[s.tool] : undefined;
  if (builtin) return builtin.mode;
  const kind = s.kind ?? "";
  if (OFFLINE_KINDS.has(kind)) return "offline";
  if (LIVE_KINDS.has(kind)) return "live";
  if (PLATFORM_KINDS.has(kind)) return "platform";
  // A tool on a tool server (a server no configured backend belongs to) is called when the run asks.
  if (s.server && !CONNECTOR_DEFS.some((c) => c.server === s.server)) return "live";
  const settings = Array.isArray(s.settings) ? s.settings : [];
  if (settings.some((k) => ["url", "dsn", "endpoint", "api_key"].includes(k))) return "live";
  if (settings.some((k) => ["path", "root"].includes(k))) return "offline";
  return null;
}
const MODE_MEANS: Record<SourceMode, string> = {
  offline: "A file or folder handed over: read from disk, not from a system.",
  live: "A connection read when the run asks.",
  platform: "The platform's own store: documents admitted to it, searched when the run asks.",
};
const MODE_LABEL: Record<SourceMode, string> = { offline: "Offline", live: "Live", platform: "Platform store" };

const RISK_TONE: Record<string, "ok" | "warn" | "err" | "neutral"> = {
  read: "ok",
  write: "warn",
  risky: "err",
  destructive: "err",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function Configuration() {
  // The open tab is in the address, which a prerendered page learns only in the browser.
  return (
    <Suspense>
      <ConfigurationTabs />
    </Suspense>
  );
}

function ConfigurationTabs() {
  const params = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = TABS.find((t) => t.id === asked)?.id ?? "models";
  const [data, setData] = useState<Data | null>(null);
  /** Why the configuration record was not read, when it was not: shown with its status and address. */
  const [failed, setFailed] = useState("");
  const [agent, setAgent] = useState<string>("");
  const [q, setQ] = useState("");
  /** The platform's own MCP server description (GET /api/mcp/server), as asked; null until it answers. */
  const [mcpAnswer, setMcpAnswer] = useState<Answer<unknown> | null>(null);
  const [mcp, setMcp] = useState<{ endpoint: string; transport: string; auth: string; tools: { name: string; description: string; action: boolean }[]; client: Record<string, unknown> } | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  /** A panel drawn in its empty form (a quiet console, nothing behind it) is open: the ones shut on this visit. Not remembered. */
  const [shut, setShut] = useState<Record<string, boolean>>({});
  /** What each panel that reads its own door says once its read has settled: true when its not-connected line is all it shows. */
  const [said, setSaid] = useState<Record<string, boolean>>({});
  const [attached, setAttached] = useState<AttachedAgent[]>([]);
  /** The element an address named after `#`, kept in view while the page above it fills in. */
  const [arrival, setArrival] = useState<{ id: string; panel: string } | null>(null);
  /** The record has had a moment to answer. Until it has, the panels are held back, so a console with nothing behind it opens on its calm form and not on a column of "Reading" lines that then fold away. */
  const [waited, setWaited] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  // The MCP registry is the backend's (phase L6); read once for the panel and the page facts.
  const registry = useMcp();
  // The peer registry (phase L7): read here so the panel's heading and the page facts carry its counts.
  const peers = usePeers();
  const { session } = useSession();
  // What the deployment's own Google identity can see on Vertex AI: its panel is drawn only when there is something to show.
  const vertex = useVertex();

  /** The address names a panel after `#`: open its tab and the panel, whatever fold is remembered for it, and bring it into view. Acts once per address. */
  const lastHash = useRef("");
  const arrive = useCallback(() => {
    const hash = window.location.hash;
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    const to = hashTarget();
    if (!to) return;
    setFolded((f) => (f[to.panel] ? { ...f, [to.panel]: false } : f));
    setShut((o) => (o[to.panel] ? { ...o, [to.panel]: false } : o));
    setArrival(to);
    // The address then names the tab too, so the tab row and a reload agree with what is on screen.
    const query = new URLSearchParams(window.location.search);
    const home = tabOf(to.panel);
    if (query.get("tab") !== home) {
      query.set("tab", home);
      window.history.replaceState(null, "", `${window.location.pathname}?${query.toString()}${hash}`);
    }
  }, []);

  const foldsRead = useRef(false);
  useEffect(
    () =>
      // The remembered folds are read after the first paint, so the server and
      // the client render the same page and the folds settle a tick later. The
      // address is looked at again whenever it changes: a link that only
      // changes what follows `#` raises no event of its own.
      soon(() => {
        if (!foldsRead.current) {
          foldsRead.current = true;
          try {
            const saved = localStorage.getItem("af.config.folds");
            if (saved) setFolded(JSON.parse(saved));
          } catch {
            /* fresh */
          }
        }
        arrive();
      }),
    [params, arrive],
  );

  useEffect(() => {
    window.addEventListener("hashchange", arrive);
    ask<NonNullable<typeof mcp>>("mcpServer").then((a) => {
      setMcpAnswer(a);
      if (a.state === "ok") setMcp(a.data);
    });
    const timer = setTimeout(() => setWaited(true), 400);
    return () => {
      window.removeEventListener("hashchange", arrive);
      clearTimeout(timer);
    };
  }, [arrive]);

  useEffect(() => {
    // Nothing to bring into view until the tab that holds it is the one shown.
    if (!arrival || !frame.current || tabOf(arrival.panel) !== tab) return;
    // The panels above the one asked for grow as their records arrive, so it is
    // brought back to the top each time the page changes height, for a few
    // seconds or until the person scrolls, types or clicks.
    let live = true;
    const bring = () => {
      if (live) (document.getElementById(arrival.id) ?? document.getElementById(arrival.panel))?.scrollIntoView({ block: "start" });
    };
    const stop = () => {
      live = false;
      watch.disconnect();
    };
    // Settled for good: coming back to this tab later does not scroll again.
    const settle = () => {
      stop();
      setArrival(null);
    };
    const watch = new ResizeObserver(bring);
    watch.observe(frame.current);
    bring();
    const timer = setTimeout(settle, 6000);
    const acts = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    acts.forEach((a) => window.addEventListener(a, settle, { passive: true }));
    return () => {
      stop();
      clearTimeout(timer);
      acts.forEach((a) => window.removeEventListener(a, settle));
    };
  }, [arrival, tab]);
  const toggle = (id: string) => {
    setFolded((f) => {
      const next = { ...f, [id]: !f[id] };
      try {
        localStorage.setItem("af.config.folds", JSON.stringify(next));
      } catch {
        /* fine */
      }
      return next;
    });
  };
  /** One reporter per panel that reads its own door (Providers, Models, Credentials, Third-party agents). */
  const says = useMemo(() => {
    const of = (id: string) => (quiet: boolean) => setSaid((s) => (s[id] === quiet ? s : { ...s, [id]: quiet }));
    return { providers: of("providers"), models: of("models"), credentials: of("credentials"), agents: of("agents") };
  }, []);

  /** Read the record. Read again after a panel below wrote something, a failure leaves the record already shown as it is. */
  const read = useCallback((again: boolean) => {
    let stop = false;
    fetch("/api/configuration")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (stop) return;
        // A refusal or a fault answers without the record: say so, with the status and the address, and show no rows.
        if (!r.ok || !d || !Array.isArray(d.sources)) return void (again || setFailed(errorText(d, r, "GET", "/api/configuration")));
        setData(d);
        setFailed("");
      })
      .catch((e) => !stop && !again && setFailed(`the backend did not answer GET /api/configuration (${(e as Error).message})`));
    return () => {
      stop = true;
    };
  }, []);
  useEffect(() => read(false), [read]);
  // The Providers, Models and Credentials panels write through their own doors; the page facts and the
  // figures on the other panels are this record's, so it is read again shortly after the last change.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped when the Models panel's clearances and fallbacks are saved: the offered list is mounted again and reads the settings afresh. */
  const [modelsRead, setModelsRead] = useState(0);
  const changed = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => read(true), 700);
  }, [read]);
  useConfigChanges(changed);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  // The workflow filter offers every workflow that holds a connection or names a tool.
  const agents = useMemo(
    () => [...new Set([...(data?.sources ?? []).map((s) => s.agent), ...(Array.isArray(data?.tools) ? data.tools : []).map((t) => registeredToolOf(t)?.agent ?? "")].filter(Boolean))].sort(),
    [data],
  );
  const sources = useMemo(() => (data?.sources ?? []).filter((s) => !agent || s.agent === agent), [data, agent]);
  const registered = useMemo(() => (Array.isArray(data?.tools) ? data.tools : []).map(registeredToolOf).filter((t): t is RegisteredTool => t !== null), [data]);
  const tools = useMemo(() => registered.filter((t) => !agent || t.agent === agent), [registered, agent]);
  const usage = tools.some((t) => t.calls !== null);
  /** Whether the answer says if a call may be made again after its worker stopped: a column only when it does. */
  const repeatShown = tools.some((t) => t.repeatable !== null);
  const used = sources.filter((s) => typeof s.calls === "number" && s.calls > 0).length;
  /** The panels that read the page's record show its failure themselves; none is drawn in an empty form. */
  const quiet = false;
  /** The fields the platform names as not built on this read: an empty list among them reads "not built", never "none". */
  const unbuilt = notBuiltOf(data);
  /** For the panels that read their own doors: false once the record has answered or failed, null until then. */
  const bare = data || failed ? false : null;
  const peerCount = peerCounts(peers.peers ?? []);

  /* Which panels show nothing but their not-connected line. The ones that read
     the page's record follow it; the ones with a door of their own say so
     themselves once they have read it, and until then are taken to follow a
     console with nothing behind it. */
  const own = (id: string) => said[id] ?? false;
  const vertexShown = Boolean(vertex.answer || vertex.error);
  const down: Record<string, boolean> = {
    vertex: false,
    providers: own("providers"),
    models: own("models"),
    registry: false,
    tools: quiet,
    mcp: false,
    sources: quiet,
    peers: false,
    agents: own("agents"),
    egress: quiet,
    credentials: own("credentials"),
    ingress: quiet,
    gates: quiet,
    deployment: quiet,
    appearance: false,
  };
  /** No panel is drawn in an empty form: a failed read shows its failure. */
  const off = (id: string) => (id ? false : Boolean(down[id]));
  /** A panel's fold: the remembered one, or, in its empty form, open until its heading is shut on this visit. */
  const fold = (id: string) =>
    off(id)
      ? { folded: Boolean(shut[id]), onToggle: () => setShut((o) => ({ ...o, [id]: !o[id] })) }
      : { folded: Boolean(folded[id]), onToggle: () => toggle(id) };
  /** Not known yet whether anything is behind the console: the panels wait a moment, out of sight, for the record. */
  const settling = bare === null && !waited;

  /* The connections the record lists: for each agent, each tool that reaches
     outside its own reasoning (a dataset, a tool on a tool server, web fetch,
     the knowledge store, a configured backend), with the calls the run
     journals hold for that tool. Nothing is added to this list; a member the
     answer leaves out is shown as not stated, never as a zero. */
  const rows = useMemo(
    () =>
      sources.map((s, i) => {
        const def = CONNECTOR_DEFS.find((c) => c.server === s.server && c.kind === s.kind);
        const builtin = s.tool ? PLATFORM_SOURCES[s.tool] : undefined;
        const kind = s.kind ?? "";
        const toolServer = !def && !builtin && s.server ? `a tool on the tool server ${s.server}` : "";
        return {
          key: `${s.agent}:${s.tool}:${s.server}:${s.slot}:${s.name}:${i}`,
          name: s.name || s.tool || "unnamed",
          // A platform tool's row is named by the answer ("Datasets handed over"); its blurb says what it is.
          kindLabel: builtin ? "" : (def?.label ?? (kind || "kind not stated")),
          what: builtin?.blurb ?? def?.blurb ?? toolServer,
          // `builtin` is the platform's own server: the tool name already says where it lives.
          wiring: [s.server === "builtin" ? "" : s.server && s.slot ? `${s.server}.${s.slot}` : s.server || "", kind, s.usesVault ? "vault credential" : ""].filter(Boolean).join(" · "),
          mode: modeOf(s),
          tool: s.tool ?? "",
          risk: s.risk ?? "",
          heldBy: s.agentName || s.agent || "",
          agent: s.agent ?? "",
          node: s.node ?? "",
          calls: typeof s.calls === "number" ? s.calls : null,
          lastUsed: s.lastUsed ?? null,
          // Whether it returns untrusted content or acts outside: null when the answer does not say.
          taints: typeof s.taints === "boolean" ? s.taints : null,
          sink: typeof s.sink === "boolean" ? s.sink : null,
        };
      }),
    [sources],
  );

  // What the in-console assistant is told about this page: the record as read, and nothing derived from a catalogue.
  usePageFacts(
    data
      ? {
          // The page is five tabs of folding panels; a panel's id after # in the address opens its tab and the panel.
          tabs: { open: tab, panels: Object.fromEntries(TABS.map((t) => [t.id, t.panels.filter((p) => p !== "vertex" || vertexShown).map((p) => TITLES[p])])) },
          deployment: data.deployment,
          egressAllowlist: data.deployment.egress,
          connections: { total: rows.length, calledAtLeastOnce: used, offline: rows.filter((r) => r.mode === "offline").length, live: rows.filter((r) => r.mode === "live").length },
          connectionList: rows.map((r) => ({ name: r.name, kind: r.kindLabel, mode: r.mode ?? "not stated", heldBy: r.heldBy, calls: r.calls })),
          tools: notBuilt(unbuilt, "tools") ? "not built" : registered.map((t) => ({ name: t.name, workflow: t.agentName, from: t.server, registered: t.registered, registeredRisk: t.risk, effectiveRisk: t.effectiveRisk, actsOutside: t.sink, untrustedOutput: t.untrusted, calls: t.calls })),
          gates: data.gates,
          models: data.models.map((m) => m.id),
          defaultModel: data.defaultModel,
          agentFactoryMcp: { endpoint: MCP_ENDPOINT, tools: mcp ? mcp.tools.map((t) => t.name) : "described at the endpoint" },
          toolServers: registry.servers
            ? {
                twoPersonApproval: registry.twoPerson,
                servers: registry.servers.map((s) => ({ id: s.id, label: s.label, status: STATUS_META[s.status].label, tools: s.pin?.tools.length ?? 0, pin: s.pin?.digest ?? null, lastScan: s.last_scan?.at ?? null, hits: s.last_scan?.hits.length ?? 0 })),
              }
            : "reading the registry",
          // As the peer registry answers: the other parties' agents this deployment may call, and may hear from.
          peers: peers.peers && !peers.error ? { registered: peers.peers.length, ...peerCount, twoPersonApproval: peers.twoPerson, list: peers.peers.map((p) => ({ id: p.id, label: p.label, status: p.status })) } : "not read",
          // As the attached-agents door answers: the figures are the backend's, measured from the run record.
          thirdPartyAgents: {
            total: attached.length,
            overSdk: attached.filter((a) => a.mode === "sdk").length,
            overA2a: attached.filter((a) => a.mode === "a2a").length,
            agents: attached.map((a) => ({ name: a.name, id: a.id, mode: a.mode, framework: a.framework, owner: a.owner, runs30d: a.runs30d, cost30d: a.cost30d, denials30d: a.denials30d })),
          },
        }
      : null,
  );
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => !term || r.name.toLowerCase().includes(term) || r.kindLabel.toLowerCase().includes(term) || r.heldBy.toLowerCase().includes(term) || r.tool.toLowerCase().includes(term));
  }, [rows, q]);

  /** The workflow filter over Connected sources and the Tool registry: one choice, shown in both panels. */
  const workflowPick = agents.length > 1 && (
    <span className="flex items-center gap-1.5">
      <span className="text-[10.5px] text-ghost">workflow</span>
      <span className="block w-[200px]">
        <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "all" }, ...agents.map((a) => ({ value: a, label: a }))]} aria-label="Workflow" />
      </span>
    </span>
  );

  /** One tab's panels. Every tab stays mounted; only the open one is shown. */
  const pane = (id: TabId, panels: React.ReactNode) => (
    <div data-tab={id} hidden={id !== tab} className={`flex flex-col gap-5 ${settling ? "invisible" : ""}`}>
      {panels}
    </div>
  );

  return (
    <div className="min-h-full">
      {/* The same frame as the control pane: full width to the same cap, the same gutter, so the two pages line up at every size. */}
      <div ref={frame} className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <GroupHeader group="configuration" tab={tab}>
          {TABS.find((t) => t.id === tab)?.about}
        </GroupHeader>

        {failed && <Failure what="The configuration could not be read, so the deployment, connections, tools, gates and ingress show nothing" message={failed} />}

        {/* ═══════════════════ models ═══════════════════ */}
        {pane(
          "models",
          <>
            {/* ── what the deployment's own Google identity can see on Vertex AI: the one place it is shown ── */}
            {vertexShown && (
              <Panel
                id="vertex"
                {...fold("vertex")}
                title={TITLES.vertex}
                caption="What this deployment's own Google identity can see on Vertex AI."
                className="has-[#vertex-body:empty]:hidden"
              >
                <VertexDetected />
              </Panel>
            )}
            {/* ── providers: where model calls can go ── */}
            <Panel
              id="providers"
              {...fold("providers")}
              title={TITLES.providers}
              caption="The endpoints this deployment was set up with. They are set when the platform is deployed, not here."
              how="A provider is a chat-completions endpoint the platform was deployed with. Its credential comes from the deployment's environment or its Google identity, never from this page. The runtime routes every call to the endpoint its model is served from."
            >
              {off("providers") && <EmptyBar action="Add provider">Providers are listed here, each with its endpoint, its vault key and the models offered from it.</EmptyBar>}
              <Kept off={off("providers")}>
                <Providers bare={bare} onQuiet={says.providers} />
              </Kept>
            </Panel>
            {/* ── models: the short list every model choice in the console shows ── */}
            <Panel
              id="models"
              {...fold("models")}
              title={TITLES.models}
              caption="What teams may pick from, the tier each sits in, the price cost figures are computed against, the classes of data each may be sent and what its calls fall back to. Every model choice in the console shows exactly this list."
              how="Tick what this deployment offers, from what its catalogue lists and what was offered from a provider under Providers. A workflow names a model, never a provider. Record the price per million tokens beside each offered model; a call's cost is counted at the price set when it is made, and a call on a model with no price set has no cost. Under the list, clear each model for the classes of data it may be sent and name its fallbacks in order."
            >
              {off("models") && <Holds>Offered models are listed here, each with its provider, its tier, its price per million tokens, its clearance and its fallbacks.</Holds>}
              <Kept off={off("models")}>
                {/* Read again after a clearance or fallback is saved below, so its own copy of the list never posts the old ones back. */}
                <OfferedModels key={modelsRead} bare={bare} onChanged={changed} onQuiet={says.models} />
                <ModelClearance
                  onSaved={() => {
                    setModelsRead((n) => n + 1);
                    changed();
                  }}
                />
              </Kept>
            </Panel>
          </>,
        )}

        {/* ═══════════════════ tools ═══════════════════ */}
        {pane(
          "tools",
          <>
            {/* ── the MCP registry: tool servers, admitted, pinned and approved ── */}
            <Panel
              id="registry"
              {...fold("registry")}
              title={TITLES.registry}
              caption="The MCP servers that carry a team's own tools to its agents. A server's tools attach to a run only after a platform admin approves its pinned tool list."
              how="Registering is admission, not trust: the server is asked for its tool list once, every tool's name, description and schema is screened, and the list is pinned by its digest. A platform admin approves the pin and sets each tool's risk; a tool left unset counts as destructive. A rescan that finds a different list marks the server changed and detaches it until it is approved again. Header values reference the vault; only their names are shown."
              meta={
                registry.servers && registry.servers.some((x) => STATUS_META[x.status].alarming) ? (
                  <Tag tone="err" solid>
                    {registry.servers.filter((x) => STATUS_META[x.status].alarming).length} need attention
                  </Tag>
                ) : (
                  <Tag tone="ok" solid>MCP</Tag>
                )
              }
            >
              <ToolServers servers={registry.servers} twoPerson={registry.twoPerson} error={registry.error} refresh={registry.refresh} />
            </Panel>
            {/* ── tools: what the deployed workflows name, beside the registry ── */}
            <Panel
              id="tools"
              {...fold("tools")}
              title={TITLES.tools}
              caption={
                notBuilt(unbuilt, "tools")
                  ? "Not built: the platform names its tool registry as not built on this deployment, so no tool is listed and none can be granted."
                  : "Every tool a deployed workflow names, beside what the platform registered about it: the built-in tools and the tools of approved tool servers. A workflow may make a tool stricter, never looser."
              }
              meta={data ? notBuilt(unbuilt, "tools") ? <NotBuiltValue field="tools" /> : <span className="tnum text-[10.5px] font-normal text-faint">{registered.length} named</span> : undefined}
            >
              {workflowPick && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                  <span className="grow" />
                  {workflowPick}
                </div>
              )}
              <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
                <table className="w-full min-w-[960px] border-collapse text-[11.5px]">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      <th className="px-4 py-2 font-medium">Tool</th>
                      <th className="px-3 py-2 font-medium">Workflow</th>
                      <th className="px-3 py-2 font-medium">Risk</th>
                      <th className="px-3 py-2 font-medium">Acts outside</th>
                      <th className="px-3 py-2 font-medium">Untrusted output</th>
                      {repeatShown && <th className="px-3 py-2 font-medium">Repeatable</th>}
                      {usage && <th className="px-3 py-2 font-medium">Calls</th>}
                      {usage && <th className="px-3 py-2 font-medium">Last used</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tools
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name) || a.agentName.localeCompare(b.agentName))
                      .map((t, i) => (
                        <tr key={`${t.agent}:${t.name}:${i}`} className="border-b border-line align-top last:border-0">
                          <td className="px-4 py-2.5">
                            <span className="flex flex-col gap-0.5">
                              <span className="font-mono text-[11px] text-fg">{t.name}</span>
                              <span className="text-[10.5px] text-faint">{t.registered === false ? "not registered" : t.server === "builtin" ? "built in" : t.server ? `tool server ${t.server}` : ""}</span>
                              {t.description && <span className="line-clamp-2 max-w-[56ch] text-[10.5px] leading-[1.45] text-faint">{t.description}</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{t.agentName || <span className="text-faint">not stated</span>}</td>
                          <td className="px-3 py-2.5">
                            {t.registered === false ? (
                              <span className="text-[11px] text-err">no tool of this name is registered: a run is refused it</span>
                            ) : t.effectiveRisk ? (
                              <span className="flex flex-col gap-0.5">
                                <Status tone={RISK_TONE[t.effectiveRisk] ?? "neutral"}>{t.effectiveRisk}</Status>
                                {(t.risk || t.declaredRisk) && (
                                  <span className="text-[10px] text-faint">
                                    registered {t.risk || "not stated"}
                                    {t.declaredRisk ? `, declared ${t.declaredRisk}` : ""}
                                  </span>
                                )}
                                {t.effectiveRisk === "destructive" && <span className="text-[10px] text-faint">every call waits for a platform admin</span>}
                              </span>
                            ) : (
                              <span className="text-faint">not stated</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">{t.sink ? <Tag tone="err">acts outside</Tag> : <span className="text-ghost">no</span>}</td>
                          <td className="px-3 py-2.5">{t.untrusted ? <Tag tone="warn">untrusted</Tag> : <span className="text-ghost">no</span>}</td>
                          {repeatShown && <td className="px-3 py-2.5 text-dim">{t.repeatable === null ? <span className="text-faint">not stated</span> : t.repeatable ? "yes" : "no"}</td>}
                          {usage && <td className="tnum px-3 py-2.5">{t.calls === null ? <span className="text-faint">not stated</span> : t.calls || <span className="text-ghost">0</span>}</td>}
                          {usage && <td className="px-3 py-2.5 whitespace-nowrap text-faint">{t.calls === null ? "" : ago(t.lastUsed)}</td>}
                        </tr>
                      ))}
                    {data && tools.length === 0 && (
                      <tr>
                        <td colSpan={5 + (repeatShown ? 1 : 0) + (usage ? 2 : 0)} className="px-4 py-3 text-faint">
                          {notBuilt(unbuilt, "tools") ? "Not built: the platform names tools as not built, so this list is empty because nothing can fill it." : agent ? "This workflow names no tool." : "No deployed workflow names a tool."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {data && !notBuilt(unbuilt, "tools") && tools.length > 0 && !repeatShown && (
                <p className="border-t border-line px-4 py-2 text-[10.5px] leading-[1.5] text-faint">
                  Whether a call to each tool may be made again after the worker making it stopped (repeatable) is not in the platform&rsquo;s answer, so it is not shown.
                </p>
              )}
            </Panel>
            {/* ── the platform as an MCP server ── */}
            <Panel
              id="mcp"
              {...fold("mcp")}
              title={TITLES.mcp}
              caption={mcp ? "Other agents and tools can read this deployment over the Model Context Protocol, as the server describes itself below." : "The platform's own MCP server, as it describes itself."}
              meta={mcp ? <Tag tone="neutral">MCP</Tag> : undefined}
            >
              {!mcp && (mcpAnswer && mcpAnswer.state !== "ok" ? <AnswerFailure className="p-4" answer={mcpAnswer} what="The MCP server description could not be read" /> : <span className="block px-4 py-3 text-[11.5px] text-faint">Reading the server description…</span>)}
              {mcp && <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className="flex flex-col bg-surface">
                  <div className="grid gap-px border-b border-line bg-line sm:grid-cols-3">
                    {[
                      { k: "Endpoint", v: mcp.endpoint || MCP_ENDPOINT, mono: true },
                      { k: "Transport", v: mcp.transport || "—", faint: !mcp.transport },
                      { k: "Authentication", v: mcp.auth || "—" },
                    ].map((f) => (
                      <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                        <span className="text-[10.5px] text-ghost">{f.k}</span>
                        <span className={`truncate text-[12px] ${f.faint ? "text-faint" : "text-fg"} ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.v}</span>
                      </div>
                    ))}
                  </div>
                  <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Tools exposed</span>
                  {(mcp?.tools ?? []).map((t) => (
                    <span key={t.name} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                      <Mono className="w-[150px] shrink-0 pt-px text-[11px] text-fg">{t.name}</Mono>
                      <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{t.description}</span>
                      <Tag tone={t.action ? "warn" : "neutral"}>{t.action ? "action" : "read"}</Tag>
                    </span>
                  ))}
                </div>
                <div className="flex flex-col bg-surface">
                  <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Connect a client</span>
                  <pre className="m-0 overflow-x-auto px-4 py-3 font-mono text-[10.5px] leading-[1.6] text-dim">
                    {JSON.stringify((mcp.client as { claude?: unknown } | undefined)?.claude ?? mcp.client ?? {}, null, 2)}
                  </pre>
                </div>
              </div>}
            </Panel>
          </>,
        )}

        {/* ═══════════════════ connections ═══════════════════ */}
        {pane(
          "connections",
          <>
            {/* ── sources: the load-bearing table ── */}
            <Panel
              id="sources"
              {...fold("sources")}
              title={TITLES.sources}
              caption={
                data && notBuilt(unbuilt, "sources")
                  ? `Not built on this deployment · ${data.deployment.runs} runs on record.`
                  : data
                  ? `${rows.length === 1 ? "1 connection" : `${rows.length} connections`} named by the agents on this deployment, ${used} called at least once · ${data.deployment.runs} runs on record.`
                  : failed
                    ? "not read"
                    : "reading the workflows…"
              }
              howLabel="How to read this table"
              how="A connection is a tool an agent holds that reaches outside its own reasoning: a dataset, a tool on a tool server, web fetch, the knowledge store, or a backend configured on a tool. Mode says whether it is offline (a file or folder handed over), live (read from a system when the run asks) or the platform's own knowledge store. Reaches says whether it returns untrusted content, acts outside the system, or both. Calls and last used are counted from the run journals; there is no health figure, because nothing measures one. Credentials are named in the vault and never held in the definition."
            >
              {data && rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search by name, kind, tool or workflow"
                    aria-label="Search connections"
                    className="focusable h-7 w-64 max-w-full rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
                  />
                  <span className="grow" />
                  {workflowPick}
                  <span className="tnum text-[10.5px] text-faint">{shown.length === rows.length ? `${rows.length} listed` : `showing ${shown.length} of ${rows.length}`}</span>
                </div>
              )}

              {!data && !failed && <p className="px-4 py-3 text-[11.5px] text-faint">Reading the workflows&hellip;</p>}
              {failed && <p className="px-4 py-3 text-[11.5px] text-faint">Not read: the configuration record failed (above).</p>}
              {data && rows.length === 0 && (
                <p className="px-4 py-6 text-[12px] leading-[1.55] text-dim">
                  {notBuilt(unbuilt, "sources")
                    ? "Not built: the platform names connected sources as not built, so this list is empty because nothing can fill it."
                    : "No agent on this deployment holds a tool that reaches outside it. A connection appears here once an agent's definition names one: a dataset, a tool on a tool server, web fetch or the knowledge store."}
                </p>
              )}

              {data && rows.length > 0 && (
                <div className="max-h-[560px] overflow-x-auto overflow-y-auto">
                  <table className="w-full min-w-[980px] border-collapse text-left">
                    <thead className="sticky top-0 z-10 bg-surface">
                      <tr className="border-b border-line text-[10.5px] text-faint">
                        <th className="px-4 py-2.5 font-medium">Source</th>
                        <th className="px-3 py-2.5 font-medium">Mode</th>
                        <th className="px-3 py-2.5 font-medium">Tool</th>
                        <th className="px-3 py-2.5 font-medium">Held by</th>
                        <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                        <th className="px-3 py-2.5 font-medium">Last used</th>
                        <th className="px-3 py-2.5 font-medium">Reaches</th>
                        <th className="px-3 py-2.5 font-medium">Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.key} className="border-b border-line align-top transition-colors last:border-0 hover:bg-raise/50">
                          <td className="max-w-[420px] px-4 py-2.5">
                            <span className="flex min-w-0 flex-col">
                              <span className="flex flex-wrap items-baseline gap-2">
                                <span className="font-mono text-[12px] font-medium text-fg">{r.name}</span>
                                {r.kindLabel && <span className="text-[11px] text-dim">{r.kindLabel}</span>}
                              </span>
                              {r.what && <span className="break-words text-[11px] text-faint">{r.what}</span>}
                              {r.wiring && <span className="mt-0.5 break-words font-mono text-[10.5px] leading-[1.5] text-ghost">{r.wiring}</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {r.mode ? (
                              <span title={MODE_MEANS[r.mode]}>
                                <Tag tone={r.mode === "live" ? "run" : "neutral"}>{MODE_LABEL[r.mode]}</Tag>
                              </span>
                            ) : (
                              <span className="text-[11px] text-ghost" title="The kind of this source does not say whether it is a file handed over or a connection.">
                                not stated
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className="flex flex-col gap-0.5">
                              <span className="font-mono text-[11px] text-dim">{r.tool || "tool not stated"}</span>
                              {r.risk ? <Status tone={RISK_TONE[r.risk] ?? "neutral"}>{r.risk}</Status> : <span className="text-[10.5px] text-ghost">risk not stated</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[11.5px]">
                            <span className="flex flex-col">
                              <span className="text-dim">{r.heldBy}</span>
                              <span className="font-mono text-[10px] text-ghost">{r.node ? `${r.agent} · ${r.node}` : r.agent}</span>
                            </span>
                          </td>
                          <td className="tnum px-3 py-2.5 text-right font-mono text-[11.5px] text-dim">{r.calls === null ? <span className="text-ghost">unknown</span> : r.calls.toLocaleString("en-GB")}</td>
                          <td className="tnum px-3 py-2.5 whitespace-nowrap text-[11.5px] text-dim">{r.calls === null && !r.lastUsed ? <span className="text-ghost">unknown</span> : ago(r.lastUsed)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <span className="flex gap-1">
                              {r.taints && <Tag tone="warn">untrusted content</Tag>}
                              {r.sink && <Tag tone="err">acts outside</Tag>}
                              {r.taints === false && r.sink === false && <span className="text-[11px] text-ghost">inside only</span>}
                              {(r.taints === null || r.sink === null) && !r.taints && !r.sink && <span className="text-[11px] text-ghost">not stated</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {r.calls === null ? <span className="text-[11px] text-ghost">unknown</span> : <Status tone={r.calls > 0 ? "ok" : "neutral"}>{r.calls > 0 ? "Called" : "Never called"}</Status>}
                          </td>
                        </tr>
                      ))}
                      {shown.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-3 text-[11.5px] text-faint">
                            Nothing matches that search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            {/* ── the peer registry: other parties' agents, admitted the way a tool server is ── */}
            <Panel
              id="peers"
              {...fold("peers")}
              title={TITLES.peers}
              caption="Other parties' agents this deployment speaks A2A with. Nothing is sent to a peer, or heard from it, until a person approves its agent card."
              how="Each peer is admitted the way a tool server is: its agent card is fetched signed and pinned by digest. A card that changes detaches the peer until someone approves it again. Every request both ways is signed under a secret the two sides share, held in the vault and shown here by name only."
              meta={peers.peers && !peers.error && peerCount.changed > 0 ? <Tag tone="err" solid>{peerCount.changed} changed</Tag> : undefined}
            >
              {off("peers") && <EmptyBar action="Register a peer">Peers are listed here, each with its agent card, the state of its approval and the secret it signs under, by name.</EmptyBar>}
              <Kept off={off("peers")}>
                <PeerList peers={peers.peers} twoPerson={peers.twoPerson} me={meOf(session)} error={peers.error} refresh={peers.refresh} bare={bare} />
              </Kept>
            </Panel>
            {/* ── third-party agents: attached over the SDK or A2A ── */}
            <Panel
              id="agents"
              {...fold("agents")}
              title={TITLES.agents}
              caption="Agents built elsewhere, attached so they run under the same journal, cost accounting and guardrails as this deployment's own. Attach over the SDK when you own the agent's code, or over A2A when its code cannot change."
              meta={
                <>
                  <Tag tone="run" solid>SDK</Tag>
                  <Tag tone="queue" solid>A2A</Tag>
                </>
              }
            >
              <AttachedAgents onLoaded={(agents) => setAttached(agents)} onQuiet={says.agents} />
            </Panel>
            {/* ── egress: the hosts outbound requests may reach (9.6) ── */}
            <Panel
              id="egress"
              {...fold("egress")}
              title={TITLES.egress}
              caption={data && notBuilt(unbuilt, "egress") ? "An egress allowlist is not built on this deployment: nothing refuses an outbound request by its host. Below is where this service is set to send requests, as the platform describes it." : "The hosts an outbound request from a run may reach."}
              how="An outbound request is a model call, a knowledge fetch, a sign-in key read, or a call to an authorization server. The platform lists where it is set to send them; it is a description, not a list that refuses other hosts."
              meta={data ? notBuilt(unbuilt, "egress") ? <NotBuiltValue field="egress" /> : <span className="tnum text-[10.5px] font-normal text-faint">{data.deployment.egress.length === 1 ? "1 host" : `${data.deployment.egress.length} hosts`}</span> : undefined}
            >
              <div className="flex flex-col gap-2 px-4 py-3">
                {!data && !failed && <span className="text-[11.5px] text-faint">Reading the deployment&hellip;</span>}
                {failed && <span className="text-[11.5px] text-faint">The allowlist could not be read.</span>}
                {data && data.deployment.egress.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.deployment.egress.map((h) => (
                      <span key={h} className="rounded-sm border border-line bg-raise px-2 py-1 font-mono text-[11px] text-fg">
                        {h}
                      </span>
                    ))}
                  </div>
                )}
                {data && data.deployment.egress.length === 0 && !notBuilt(unbuilt, "egress") && (
                  <span className="text-[12px] text-dim">No host is listed for this deployment.</span>
                )}
                {data && notBuilt(unbuilt, "egress") && (
                  <>
                    <span className="text-[12px] text-dim">
                      Allowlist: <NotBuiltValue field="egress" />
                    </span>
                    {(data.deployment.outbound ?? []).length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {(data.deployment.outbound ?? []).map((line) => (
                          <li key={line} className="font-mono text-[11px] text-fg">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </Panel>
          </>,
        )}

        {/* ═══════════════════ access ═══════════════════ */}
        {pane(
          "access",
          <>
            {/* ── credentials: the vault ── */}
            <Panel
              id="credentials"
              {...fold("credentials")}
              title={TITLES.credentials}
              caption="What the vault holds, by name. A value is pasted here once and never shown again."
              how="A tool server's header or a workflow's tool argument names a credential as ${secret:name} and never holds the value, which is what makes a workflow safe to export. The value is read at the moment a call is made."
            >
              {off("credentials") && <EmptyBar action="Add a key">Vault keys are listed here by name.</EmptyBar>}
              <Kept off={off("credentials")}>
                <Keys bare={bare} onChanged={changed} onQuiet={says.credentials} />
              </Kept>
            </Panel>
            {/* ── ingress ── */}
            <Panel
              id="ingress"
              {...fold("ingress")}
              title={TITLES.ingress}
              caption="Who may post work to this factory, and what is in the queue. A key scoped to one workflow cannot start another."
            >
              {quiet ? (
                <div className="grid gap-px bg-line sm:grid-cols-2">
                  <div className="flex flex-col bg-surface">
                    <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">API keys</span>
                    <Holds>Keys that may post work are listed here, each with the workflow it is scoped to.</Holds>
                  </div>
                  <div className="flex flex-col bg-surface">
                    <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Queue</span>
                    <Holds>Jobs in the queue are counted here by state.</Holds>
                  </div>
                </div>
              ) : <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col bg-surface">
                  <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">API keys</span>
                  <ApiKeys />
                </div>
                <div className="flex flex-col bg-surface">
                  <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Queue</span>
                  {queueTotals({ all: data?.queue ?? {} }, Object.keys(data?.queue ?? {}).length > 0).map((q) => (
                    <span key={q.status} className="flex items-center justify-between border-b border-line px-4 py-2 last:border-0" title={JOB_STATUS_META[q.status as keyof typeof JOB_STATUS_META]?.means}>
                      <span className="text-[11.5px] text-faint">{q.label}</span>
                      <span className="tnum text-[12px]">{q.count}</span>
                    </span>
                  ))}
                  {data && Object.keys(data.queue).length === 0 && (
                    <span className="px-4 py-2 text-[11.5px] text-faint">The queue is empty.</span>
                  )}
                </div>
              </div>}
            </Panel>
            {/* ── gates ── */}
            <Panel
              id="gates"
              {...fold("gates")}
              title={TITLES.gates}
              caption="Per workflow: the risk level at which an action stops and waits for a human, and who may answer. A gate with no approver is refused at parse time, so every line here has a name behind it."
            >
              {quiet && <Holds>Each workflow that declares a gate is listed here with the risk level it stops at and who may answer.</Holds>}
              {(data?.gates ?? []).length === 0 && data && (
                <p className="px-4 py-3 text-[11.5px] text-faint">
                  No workflow declares a gate. Every action runs on the agent&rsquo;s own authority.
                </p>
              )}
              {(data?.gates ?? []).map((g, i) => (
                <div key={`${g.agent}-${i}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <span className="min-w-0 grow text-[12px]">{g.agentName}</span>
                  <span className="text-[11.5px] text-faint">
                    gates <Mono className="text-[11px]">{g.atOrAbove}</Mono> and above
                  </span>
                  <span className="shrink-0 text-[11px] text-faint">
                    {g.approvers.length ? g.approvers.join(", ") : "nobody named"}
                  </span>
                </div>
              ))}
            </Panel>
          </>,
        )}

        {/* ═══════════════════ deployment ═══════════════════ */}
        {pane(
          "deployment",
          <>
            {/* ── deployment ── */}
            <Panel id="deployment" {...fold("deployment")} title={TITLES.deployment} caption="Where this deployment keeps its records and what it sends model calls to.">
              {quiet ? (
                <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                  {["Registry", "Model gateway", "Gateway resource", "Billing feed", "Workflows", "Runs on record"].map((k) => (
                    <div key={k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                      <span className="text-[10.5px] text-ghost">{k}</span>
                      <span className="truncate text-[12px] text-faint">Not connected</span>
                    </div>
                  ))}
                </div>
              ) : <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { k: "Registry", v: !data ? "—" : data.deployment.registry === "postgres" ? "Postgres" : "Workspace files" },
                  { k: "Model gateway", v: !data ? "—" : data.deployment.gateway === "not configured" ? "Not configured" : data.deployment.gateway },
                  { k: "Gateway resource", v: !data ? "—" : data.deployment.endpoint?.replace(/^https:\/\//, "") || "None set", mono: Boolean(data?.deployment.endpoint) },
                  { k: "Billing feed", v: !data ? "—" : notBuilt(unbuilt, "billing") ? "Not built" : data.deployment.billing ? "Connected" : "Not connected" },
                  { k: "Workflows", v: !data ? "—" : `${data.deployment.workflows} saved · ${data.deployment.deployed} deployed` },
                  { k: "Runs on record", v: !data ? "—" : `${data.deployment.runs} · the basis for usage figures` },
                ].map((f) => (
                  <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                    <span className="text-[10.5px] text-ghost">{f.k}</span>
                    <span className={`truncate text-[12px] text-fg ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.v}</span>
                  </div>
                ))}
              </div>}
            </Panel>
            {/* ── appearance: the console's own look ── */}
            <Panel
              id="appearance"
              {...fold("appearance")}
              title={TITLES.appearance}
              caption="How the console looks: one choice for every browser and every person. Card headers carry a colour for their subject, or the console stays on its monochrome base."
              howLabel="Which colour means what"
              how="Spend is green, approvals amber, live activity blue, controls red, knowledge violet, identity teal and traces indigo."
            >
              {off("appearance") && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  <span className="min-w-0 text-[11.5px] leading-[1.5] text-faint">The look in use is named here, with the choice between subject colours and monochrome.</span>
                  <span className="grow" />
                  <Button size="sm" variant="solid" tone="neutral" disabled>Subject colours</Button>
                  <Button size="sm" variant="solid" tone="neutral" disabled>Monochrome</Button>
                </div>
              )}
              <Kept off={off("appearance")}>
                <Appearance bare={bare} />
              </Kept>
            </Panel>
          </>,
        )}

        <p className="pb-4 text-[10.5px] text-ghost">{data?.basis ?? ""}</p>
      </div>
    </div>
  );
}

/* A panel's empty form in a quiet console (lib/quiet.ts): what it holds, in one line, with its bar or its columns. */

/** The one line: what the panel holds, in the present tense, and no claim that there is none. */
function Holds({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-[11.5px] leading-[1.5] text-faint">{children}</p>;
}

/** The bar a panel's button sits on. The button is drawn and waits for the connection. */
function EmptyBar({ action, children }: { action: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <span className="min-w-0 max-w-[92ch] text-[11.5px] leading-[1.5] text-faint">{children}</span>
      <span className="grow" />
      <Button size="sm" variant="solid" tone="ink" disabled>
        {action}
      </Button>
    </div>
  );
}

/** A table's columns over the one line. */
function EmptyTable({ cols, min = "min-w-[720px]", children }: { cols: string[]; min?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${min} border-collapse text-left text-[11.5px]`}>
        <thead>
          <tr className="border-b border-line text-[10.5px] text-faint">
            {cols.map((c, i) => (
              <th key={c} className={`${i === 0 ? "px-4" : "px-3"} py-2 font-medium`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={cols.length} className="px-4 py-3 leading-[1.5] text-faint">
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** A panel that reads its own door stays mounted behind its empty form, out of sight, so it still says when its door answers. */
function Kept({ off, children }: { off: boolean; children: React.ReactNode }) {
  // One wrapper either way, so the panel is not mounted again when its door answers; shown, the wrapper is no box of its own.
  return (
    <div hidden={off} className={off ? undefined : "contents"}>
      {children}
    </div>
  );
}

/**
 * A folding panel: its heading, one or two sentences on what it is for, and
 * its body. `how` is what a person needs once (how the mechanism works, how
 * to read the table): kept behind a small disclosure under the caption.
 */
function Panel({
  id,
  title,
  caption,
  how,
  howLabel = "How this works",
  children,
  folded = false,
  onToggle,
  meta,
  className = "",
}: {
  id: string;
  title: string;
  caption: string;
  how?: string;
  howLabel?: string;
  children: React.ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  meta?: React.ReactNode;
  className?: string;
}) {
  const [explained, setExplained] = useState(false);
  return (
    <section id={id} className={`flex scroll-mt-4 flex-col overflow-hidden rounded-md border border-line bg-surface ${className}`}>
      {/* The heading band: the fold, and under the caption the disclosure, which is no part of the fold's button. */}
      <div data-hue={hueFor(title)} className={`flex flex-col bg-raise/55 transition-colors [&:where(:has(>button:hover))]:bg-raise ${folded ? "" : "border-b border-line"}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!folded}
          aria-controls={`${id}-body`}
          className="focusable flex w-full items-start gap-3 px-4 py-2.5 text-left"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-0.5 shrink-0 text-faint transition-transform ${folded ? "-rotate-90" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[12px] font-semibold">
              {title}
              {meta}
            </span>
            {!folded && <span className="max-w-[92ch] text-[11px] leading-[1.55] text-faint">{caption}</span>}
          </span>
          <span className="shrink-0 pt-0.5 text-[10.5px] text-ghost">{folded ? "show" : "hide"}</span>
        </button>
        {!folded && how && (
          <div className="flex flex-col items-start gap-1.5 pr-4 pb-2.5 pl-[42px]">
            <button
              type="button"
              onClick={() => setExplained(!explained)}
              aria-expanded={explained}
              aria-controls={`${id}-how`}
              className="focusable inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-sm border border-line bg-surface px-1.5 text-[10.5px] font-medium text-dim transition-colors hover:bg-raise hover:text-fg"
            >
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform ${explained ? "" : "-rotate-90"}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
              {howLabel}
            </button>
            <p id={`${id}-how`} hidden={!explained} className="max-w-[92ch] text-[11px] leading-[1.55] text-faint">
              {how}
            </p>
          </div>
        )}
      </div>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}

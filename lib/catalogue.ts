/**
 * The essential capabilities.
 *
 * These are **tools, not vendor connectors**, and the distinction is the whole
 * architecture. An agent asks to retrieve something. It does not ask to
 * retrieve from SharePoint. `retrieval.search` is one MCP endpoint that any
 * agent can hold, and behind that endpoint the retrieval service fans out to
 * whatever vendors that deployment actually has — configured there, at deploy
 * time, by whoever owns the connection.
 *
 *     agent  ──holds──▶  retrieval.search  ──▶  wiki · drive · store · S3
 *                        (one MCP endpoint)      (configured in the service)
 *
 * ── How this set was derived ──────────────────────────────────────────────
 *
 * An agent is a model loop. Everything it does beyond producing tokens happens
 * through a tool, so the question is what *kinds* of thing a tool can do.
 * There are four, and they are the four groups below: information comes in,
 * computation happens, something is remembered, something goes out.
 *
 * Within "in", the axis that matters is not the vendor. It is **who authored
 * what comes back**, because that is what decides taint. A policy PDF and a
 * log line are both text; one was written by a colleague and one may have been
 * written by whoever we are investigating.
 *
 * Within "out", the axis is **how reversible it is**, because that is what
 * decides gating. Opening a ticket and closing a case are both writes; only one
 * of them ends someone's ability to notice a mistake.
 *
 * A capability earns a place here if an agent cannot be useful without it and
 * every team would otherwise build it again. Anything narrower is a plugin,
 * and anything vendor-shaped belongs behind one of these endpoints.
 */

import PARAMS from "./tool-params.json";
import type { Risk, Tool } from "./spec";

export interface Capability extends Tool {
  group: string;
  /** What the service behind this endpoint typically fans out to. */
  behind: string;
  /** Why this one is essential rather than a plugin. Shown on hover. */
  why?: string;
}

export const GROUPS = ["Documents", "Systems", "Code", "Compute", "Memory", "Action"] as const;

export const CATALOGUE: Capability[] = [
  /* ═══ IN — documents. Prose someone else wrote, wherever it lives. ═══
     Everything in this group taints, without exception. That is not caution;
     it is the definition. A document we did not author is a document whose
     author had an opportunity. */
  {
    name: "retrieval.search",
    group: "Documents",
    risk: "read",
    server: "retrieval",
    summary: "Search the corpora this deployment is connected to",
    behind: "Wikis, document stores, drives, object storage, mail archives",
    why: "No agent reasons about a domain without reading that domain's documents.",
    taints: true,
  },
  {
    name: "retrieval.fetch",
    group: "Documents",
    risk: "read",
    server: "retrieval",
    summary: "Fetch one document by identifier",
    behind: "The same stores, addressed directly rather than searched",
    why: "Search finds a candidate; something has to read it in full.",
    taints: true,
  },
  {
    name: "web.search",
    group: "Documents",
    risk: "read",
    server: "web",
    summary: "Search the public web",
    behind: "Whichever search provider the deployment is licensed for",
    why: "Advisories, vendor disclosures and standards live outside the tenancy.",
    taints: true,
  },
  {
    name: "web.fetch",
    group: "Documents",
    risk: "read",
    server: "web",
    summary: "Fetch a URL and return its readable content",
    behind: "An egress-controlled fetcher with a destination allowlist",
    why: "The most hostile input surface there is, and the one hardest to do without.",
    taints: true,
  },

  /* ═══ IN — systems. Two different questions, not one. ═══ */
  {
    name: "record.query",
    group: "Systems",
    risk: "read",
    server: "records",
    summary: "Look up controls, findings, vendors, exceptions, entitlements",
    behind: "GRC platforms, identity directories, CMDBs, vendor registers",
    why: "Every assessment judgement needs the register the triggering event did not carry.",
    // Deliberately clean. These are structured facts our own administrators
    // maintain — a department, a group membership, an owner. The exception is a
    // record with a free-text field somebody outside filled in; where a
    // deployment has one of those, set taints on that binding rather than
    // tainting every lookup and making the mark mean nothing.
  },
  {
    name: "event.query",
    group: "Systems",
    risk: "read",
    server: "events",
    summary: "Search telemetry, audit trails and DLP events over a time range",
    behind: "SIEM, DLP consoles, audit logs, flow records",
    why: "A register says what should be true; only telemetry says what happened.",
    // Taints, and this one gets missed. A log line is our file, but its fields
    // — usernames, URLs, user agents, filenames — are frequently written by
    // whoever we are investigating. Logs are a delivery mechanism.
    taints: true,
  },

  /* ═══ IN — code. Its own group because addressing it is not like documents.
     You do not search for a file, you name it at a ref. ═══ */
  {
    name: "code.read",
    group: "Code",
    risk: "read",
    server: "code",
    summary: "Read a tree, a file, or a diff at a ref",
    behind: "Git hosts, working copies, artifact stores",
    why: "Source under audit is authored by someone else, by definition.",
    taints: true,
  },
  {
    name: "code.parse",
    group: "Code",
    risk: "read",
    server: "code",
    summary: "Parse source into a syntax tree, symbols and references",
    behind: "Language grammars and analysers",
    why: "Reasoning about code from raw text rather than structure is where scanners go wrong.",
  },

  /* ═══ COMPUTE — the answer to "what about the parts that must be exact".
     You build it, you run it, the agent calls it and gets a typed result. ═══ */
  {
    name: "engine.run",
    group: "Compute",
    risk: "read",
    server: "engines",
    summary: "Run a registered deterministic computation and return a typed result",
    behind: "Scorers, simulators, solvers, quantification models — whatever the team built",
    why: "The escape hatch that keeps arithmetic out of a language model.",
    // Does not taint on its own: we computed it. If its inputs were tainted the
    // output stays tainted anyway, because the mark travels with derived values.
  },
  {
    name: "sandbox.execute",
    group: "Compute",
    risk: "write",
    server: "sandbox",
    summary: "Execute something in an isolated container and report what happened",
    behind: "Ephemeral runners with no network and no persistence",
    why: "Some claims are only settled by running them — an exploit either fires or it does not.",
    // Deliberately NOT a sink, and this is the most consequential call in the
    // file. This is the one place tainted content is *supposed* to end up:
    // proving an exploit means executing attacker-controlled input on purpose.
    // Marking it a sink would refuse exactly the use case it exists for. The
    // isolation is what makes that safe, so the isolation is not optional.
  },

  {
    name: "document.write",
    group: "Compute",
    risk: "write",
    server: "documents",
    summary: "Create a document in md, json, csv, html, docx, pdf or xlsx",
    behind: "Format renderers writing to the deployment's outbox",
    why: "A conclusion that never becomes an artefact somebody can file has not finished the job.",
    is_sink: true,
  },

  {
    name: "spec.reference",
    group: "Compute",
    risk: "read",
    server: "spec",
    summary: "The authoring reference: harnesses, capabilities, connector kinds, rules",
    behind: "Introspected from the runtime itself — it cannot drift from what parses",
    why: "An agent that builds agents needs the law of the land, from the land.",
  },
  {
    name: "spec.propose",
    group: "Compute",
    risk: "write",
    server: "spec",
    summary: "Validate a spec with the deployment parser; park it as a draft when valid",
    behind: "The same parser that guards deployment — there is no second door",
    why: "Authoring through the validated door is what makes an agent-builder safe.",
    is_sink: true,
  },

  /* ═══ REMEMBER — what outlives a run. ═══ */
  {
    name: "store.get",
    group: "Memory",
    risk: "read",
    server: "store",
    summary: "Read state this system persisted on an earlier run",
    behind: "The deployment's own keyed store",
    why: "Without it every run starts from nothing and re-reports what was already accepted.",
  },
  {
    name: "store.put",
    group: "Memory",
    risk: "write",
    server: "store",
    summary: "Persist state for later runs to read",
    behind: "The same store, writing",
    why: "Dispositions, accepted risks and dedupe keys have to survive the run that made them.",
    // A sink, which surprises people — nothing leaves the tenancy. But durable
    // memory is trusted by every future run, so writing attacker-authored
    // content into it is the persistence attack: say it once, be believed
    // forever. Taint stops at the store rather than being laundered by it.
    is_sink: true,
  },

  /* ═══ OUT — ordered by what a mistake costs. ═══ */
  {
    name: "record.write",
    group: "Action",
    risk: "write",
    server: "records",
    summary: "Record a finding, assessment result or exception",
    behind: "GRC platforms, ticketing, evidence registers",
    why: "An assessment that records nothing did not happen, as far as an auditor is concerned.",
    is_sink: true,
    scope: { type: ["finding", "assessment", "exception", "task"] },
  },
  {
    name: "notify.send",
    group: "Action",
    risk: "risky",
    server: "notify",
    summary: "Send a message to a person or a channel",
    behind: "Mail, chat and paging transports",
    why: "The point of triage is that somebody hears about it.",
    is_sink: true,
    scope: { to: ["*@your-org.example"] },
  },
  {
    name: "peer.discover",
    group: "Action",
    risk: "read",
    server: "peers",
    summary: "Read an external A2A agent's card — what it says it can do",
    behind: "Any agent speaking the A2A protocol: vendor bots, other teams' deployments",
    why: "Interop starts with knowing what the other side offers.",
    taints: true,
  },
  {
    name: "peer.send",
    group: "Action",
    risk: "risky",
    server: "peers",
    summary: "Hand a task to an external agent; returns only the receipt",
    behind: "A2A tasks/send on the configured peer",
    why: "Client estates already have agents. Working with them beats replacing them.",
    is_sink: true,
  },
  {
    name: "peer.result",
    group: "Action",
    risk: "read",
    server: "peers",
    summary: "Read an external agent's answer to a task you sent",
    behind: "A2A tasks/get, polled until the peer settles",
    why: "A third party's output is untrusted input, and arrives marked as such.",
    taints: true,
  },
  {
    name: "agent.invoke",
    group: "Action",
    risk: "risky",
    server: "agents",
    summary: "Call another agent in this deployment and wait for its result",
    behind: "The control plane's registry of deployed agents",
    why: "How systems compose without one graph having to hold everything.",
    // A sink because the callee can act even though the caller cannot. Least
    // privilege is per agent, so calling one is how a node reaches capability
    // it was not granted — which is legitimate, and exactly why it is gated.
    is_sink: true,
  },
  {
    name: "finding.dispose",
    group: "Action",
    risk: "destructive",
    server: "records",
    summary: "Close an alert or finding with a disposition",
    behind: "DLP consoles, GRC platforms, alert queues",
    why: "Somebody has to be able to end a triage, and it is the one act that cannot be undone.",
    is_sink: true,
    // The textbook steered-but-permitted action: auto-closing a real
    // exfiltration breaks no rule — the harm is entirely in the disposition
    // being wrong. Scope holds it to outcomes somebody signed off in advance.
    scope: { disposition: ["false-positive", "benign", "duplicate", "remediated"] },
  },
];

export const BY_NAME = new Map(CATALOGUE.map((t) => [t.name, t]));

/** The MCP servers these capabilities resolve to. */
export const SERVERS = [...new Set(CATALOGUE.map((c) => c.server))];

export function riskOf(name: string): Risk {
  return BY_NAME.get(name)?.risk ?? "read";
}

/**
 * The capability stripped back to what the spec document carries — plus the
 * tool's argument schema.
 *
 * The signature travels *in the spec* rather than being looked up by the
 * runtime, and that is what lets the runtime call a tool it has never heard of.
 * A team registering their own MCP server does not need a runtime release; the
 * spec already says what the tool takes. It also keeps the spec digest stable,
 * since nothing is being injected at run time that the builder did not show.
 */
export function asTool(c: Capability): Tool {
  // The three card-only fields are peeled off; the rest is the tool as a spec binds it.
  const { group, behind, why, ...tool } = c;
  void group;
  void behind;
  void why;
  const params = (PARAMS as Record<string, unknown>)[c.name];
  return params ? { ...tool, params: params as Record<string, unknown> } : tool;
}

/* ═══════════════════ Tool cards ═══════════════════
   What the palette shows: one card per job, mapping onto one or two
   capabilities underneath. The consolidation is the pitch made concrete — you
   drag in “Retrieval”, not four vendor SDKs, and what it reaches is decided by
   the connectors attached to it, not by the graph.
*/

export interface ToolCard {
  id: string;
  label: string;
  blurb: string;
  /** The capability names granted when this card lands on an agent. */
  capabilities: string[];
  /** Whether the connectors rail applies to this tool. */
  connectable?: boolean;
  icon: string; // key into the icon set in components/builder/icons.tsx
}

export const TOOL_CARDS: ToolCard[] = [
  {
    id: "retrieval",
    label: "Retrieval",
    blurb: "Finds and reads from whatever connectors are attached — folders, indexes, the web.",
    capabilities: ["retrieval.search", "retrieval.fetch"],
    connectable: true,
    icon: "search",
  },
  {
    id: "write-document",
    label: "Write document",
    blurb: "Produces real files: md, json, csv, html, docx, pdf, xlsx.",
    capabilities: ["document.write"],
    icon: "file",
  },
  {
    id: "records",
    label: "Records",
    blurb: "Looks up and writes entities in the systems of record.",
    capabilities: ["record.query", "record.write"],
    icon: "database",
  },
  {
    id: "events",
    label: "Events",
    blurb: "Searches telemetry and history over a time range.",
    capabilities: ["event.query"],
    icon: "pulse",
  },
  {
    id: "code",
    label: "Code",
    blurb: "Reads trees and diffs; parses source into structure.",
    capabilities: ["code.read", "code.parse"],
    icon: "code",
  },
  {
    id: "compute",
    label: "Compute",
    blurb: "Runs registered deterministic engines and sandboxed executions.",
    capabilities: ["engine.run", "sandbox.execute"],
    icon: "chip",
  },
  {
    id: "memory",
    label: "Memory",
    blurb: "State that outlives the run — dispositions, dedupe keys, accepted risks.",
    capabilities: ["store.get", "store.put"],
    icon: "layers",
  },
  {
    id: "notify",
    label: "Notify",
    blurb: "Sends to a person or a channel. Scoped, gated, journalled.",
    capabilities: ["notify.send"],
    icon: "bell",
  },
  {
    id: "peer",
    label: "Peer agents",
    blurb: "Works with external agents over A2A — send a task, read the answer, both governed.",
    capabilities: ["peer.discover", "peer.send", "peer.result"],
    connectable: true,
    icon: "bot",
  },
  {
    id: "authoring",
    label: "Authoring",
    blurb: "Builds agents: the reference, and proposals through the validated door.",
    capabilities: ["spec.reference", "spec.propose"],
    icon: "bot",
  },
  {
    id: "dispose",
    label: "Disposition",
    blurb: "Closes an alert or finding. The one act that cannot be undone.",
    capabilities: ["finding.dispose"],
    icon: "gavel",
  },
];

/* ═══════════════════ Connectors ═══════════════════
   What retrieval plugs into. A connector card hangs beneath the agent that
   holds retrieval; its config is a retrieval source in the spec.
*/

export interface ConnectorMeta {
  kind: string; // retrieval source kind
  label: string;
  blurb: string;
  icon: string;
  /** Brand name in brands.json when a real mark exists. */
  brand?: string;
  /** Accent used for the card's spine and lettermark. */
  hex: string;
}

export const CONNECTORS: ConnectorMeta[] = [
  { kind: "folder", label: "Folder", blurb: "Plain files on disk", icon: "folder", hex: "#5C7CFA" },
  { kind: "documents", label: "Documents", blurb: "PDF, DOCX, HTML", icon: "file", hex: "#0B7285" },
  { kind: "vector", label: "Vector DB", blurb: "Qdrant, Chroma, …", icon: "vector", hex: "#7048E8" },
  { kind: "tavily", label: "Tavily", blurb: "The live web", icon: "globe", hex: "#2F6BFF" },
  { kind: "images", label: "Images", blurb: "Pictures + sidecars", icon: "image", hex: "#E8590C" },
  { kind: "tool", label: "External tool", blurb: "Any search API", icon: "plug", hex: "#087F5B" },
];

export const TOOL_BY_ID = new Map(TOOL_CARDS.map((t) => [t.id, t]));
export const CONNECTOR_BY_KIND = new Map(CONNECTORS.map((c) => [c.kind, c]));

/** The tool card that granted a capability, for display grouping. */
export function toolCardOf(capability: string): ToolCard | undefined {
  return TOOL_CARDS.find((t) => t.capabilities.includes(capability));
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import { BY_NAME, TOOL_BY_ID, toolCardOf, type ToolCard } from "@/lib/catalogue";
import type { ConnectorDef } from "@/lib/connections";
import { RISK, RISK_ORDER, type AgentSystem, type Risk } from "@/lib/spec";
import type { McpServer } from "@/lib/use-mcp";
import { BRAND_NAMES, BrandMark, brandOf } from "../brand";
import { Icon } from "./icons";

/**
 * The builder's visual vocabulary, defined once.
 *
 * Three things need a face on the canvas, in the rail and in the inspector:
 * a built-in tool, a team's own MCP server, and a connector. Each gets one
 * mark — a glyph in a fixed hue, a real vendor logo, or a tile keyed to a
 * server id — and one risk treatment, so the eye learns each identity once
 * and finds it again everywhere. Nothing here is decided per view.
 */

/* ═══════════════════ Built-in tools ═══════════════════
   Ten categorical hues for eleven tools, assigned by hand and fixed per id
   — never by index, so a card keeps its colour when the list changes. The
   eleventh, Disposition, takes the destructive tone on purpose: it is the
   one act that cannot be undone, and its tile should say so. */

export const TOOL_VISUAL: Record<string, { icon: string; hue: string }> = {
  retrieval: { icon: "search", hue: "--t-c2" },
  "write-document": { icon: "file", hue: "--t-c3" },
  records: { icon: "database", hue: "--t-c1" },
  events: { icon: "pulse", hue: "--t-c7" },
  code: { icon: "code", hue: "--t-c10" },
  compute: { icon: "chip", hue: "--t-c5" },
  memory: { icon: "layers", hue: "--t-c6" },
  notify: { icon: "bell", hue: "--t-c8" },
  peer: { icon: "exchange", hue: "--t-c4" },
  authoring: { icon: "pen", hue: "--t-c9" },
  dispose: { icon: "gavel", hue: "--t-err" },
};

export function toolVisual(card: ToolCard | string): { icon: string; hue: string } {
  const id = typeof card === "string" ? card : card.id;
  const fallback = typeof card === "string" ? TOOL_BY_ID.get(card)?.icon : card.icon;
  return TOOL_VISUAL[id] ?? { icon: fallback ?? "chip", hue: "--t-fg-3" };
}

/** The verbs a card grants — `retrieval.search` reads as "search". */
export function cardVerbs(card: ToolCard): string[] {
  return [...new Set(card.capabilities.map((c) => c.split(".").pop() ?? c))];
}

export function highestRisk(risks: Risk[]): Risk {
  return risks.reduce<Risk>(
    (top, r) => (RISK_ORDER.indexOf(r) > RISK_ORDER.indexOf(top) ? r : top),
    "read",
  );
}

/** A card is as risky as the riskiest capability it grants. */
export function cardRisk(card: ToolCard): Risk {
  return highestRisk(card.capabilities.map((c) => BY_NAME.get(c)?.risk ?? "read"));
}

/* ═══════════════════ Tiles ═══════════════════ */

/** A tinted square with a glyph in it. `hue` is a design token name
 *  (`--t-c2`); `hex` is a vendor colour, which is the one place a raw
 *  colour is allowed. */
export function Tile({
  hue,
  hex,
  size = 24,
  children,
  className = "",
  title,
  style,
}: {
  hue?: string;
  hex?: string;
  size?: number;
  children: ReactNode;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const colour = hex ?? `var(${hue ?? "--t-fg-3"})`;
  return (
    <span
      title={title}
      className={`grid shrink-0 place-items-center ${size >= 22 ? "rounded-md" : "rounded-[4px]"} ${className}`}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${colour} 13%, transparent)`,
        color: colour,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function ToolMark({
  card,
  size = 24,
  title,
}: {
  card: ToolCard | string;
  size?: number;
  title?: string;
}) {
  const v = toolVisual(card);
  return (
    <Tile hue={v.hue} size={size} title={title}>
      <Icon name={v.icon} size={Math.round(size * 0.56)} />
    </Tile>
  );
}

/* ═══════════════════ Risk ═══════════════════ */

/** The Status treatment — a tone dot beside the word, on a neutral ground —
 *  so a risk level is never carried by colour alone. `compact` drops the
 *  chip border for dense rows. */
export function RiskPill({ risk, compact = false }: { risk: Risk; compact?: boolean }) {
  const meta = RISK[risk];
  return (
    <span
      title={meta.means}
      className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-medium whitespace-nowrap text-dim ${
        compact ? "" : "rounded-sm border border-line bg-raise px-1 py-px"
      }`}
    >
      <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: `var(${meta.tone})` }} />
      {meta.label}
    </span>
  );
}

/* ═══════════════════ MCP servers ═══════════════════
   A server is a team's own thing, but it is often a stand-in for, or a
   wrapper around, a vendor — and when its label or id says which vendor,
   the vendor's real mark is the most honest identity it can have. Matching
   is on whole words (runs of up to three), never substrings: "sandbox" must
   not become Box and "wizard" must not become Wiz. */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Shorthand people actually type into a server name. */
const ALIASES: Record<string, string> = {
  entra: "Entra ID",
  azuread: "Entra ID",
  aad: "Entra ID",
  microsoft: "Microsoft",
  msft: "Microsoft",
  m365: "Microsoft",
  o365: "Microsoft",
  office365: "Microsoft",
  defender: "Microsoft Defender",
  purview: "Microsoft Purview",
  gcp: "Google Cloud",
  gdrive: "Google Drive",
  aws: "Amazon S3",
  s3: "Amazon S3",
  postgresql: "Postgres",
  pg: "Postgres",
  elasticsearch: "Elasticsearch",
  mongo: "MongoDB",
  k8s: "Kubernetes",
  paloalto: "Palo Alto Networks",
  sonarqube: "Sonar",
  monday: "Monday.com",
  sfdc: "Salesforce",
  aquasec: "Aqua Security",
  orca: "Orca Security",
  lseg: "Refinitiv",
  pingid: "Ping Identity",
  adobesign: "Adobe Sign",
  snow: "ServiceNow",
};

const BRAND_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const name of BRAND_NAMES) m.set(norm(name), name);
  for (const [k, v] of Object.entries(ALIASES)) m.set(k, v);
  return m;
})();

/** The vendor a server names, if its label or id names one. */
export function brandForServer(id: string, label?: string): string | null {
  // A separator token keeps runs from crossing between label and id.
  const toks = [...words(label ?? ""), "|", ...words(id)];
  for (let len = 3; len >= 1; len--) {
    for (let i = 0; i + len <= toks.length; i++) {
      const run = toks.slice(i, i + len);
      if (run.includes("|")) continue;
      const hit = BRAND_INDEX.get(run.join(""));
      if (hit) return hit;
    }
  }
  return null;
}

/** A stable categorical hue for a server without a vendor mark. Hashed from
 *  the id, so the same server is the same colour in every session. */
export function serverHue(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return `--t-c${(Math.abs(h) % 10) + 1}`;
}

export function ServerMark({
  id,
  label,
  size = 24,
  title,
}: {
  id: string;
  label?: string;
  size?: number;
  title?: string;
}) {
  const brand = brandForServer(id, label);
  if (brand) {
    return (
      <Tile hex={brandOf(brand).hex} size={size} title={title ?? brand}>
        <BrandMark name={brand} size={Math.round(size * 0.6)} />
      </Tile>
    );
  }
  return (
    <Tile hue={serverHue(id)} size={size} title={title}>
      <Icon name="server" size={Math.round(size * 0.56)} />
    </Tile>
  );
}

/** Label lookup for a server id, from whatever the rail has discovered. */
export function serverLabel(servers: McpServer[] | null | undefined, id: string): string | undefined {
  return servers?.find((s) => s.id === id)?.label;
}

/* ═══════════════════ Connectors ═══════════════════ */

/** Connector kinds that are a vendor rather than a protocol. */
const CONNECTOR_BRAND: Record<string, string> = {
  postgres: "Postgres",
  slack: "Slack",
};

/** Glyphs sharper than the def's own for a few protocol kinds. */
const CONNECTOR_ICON: Record<string, string> = {
  smtp: "mail",
  a2a: "exchange",
  rest: "api",
  git: "git",
};

export function connectorBrand(def: ConnectorDef): string | null {
  const own = (def as ConnectorDef & { brand?: string }).brand;
  return own ?? CONNECTOR_BRAND[def.kind] ?? null;
}

export function ConnectorMark({ def, size = 24 }: { def: ConnectorDef; size?: number }) {
  const brand = connectorBrand(def);
  return (
    <Tile hex={def.hex} size={size}>
      {brand ? (
        <BrandMark name={brand} size={Math.round(size * 0.6)} />
      ) : (
        <Icon name={CONNECTOR_ICON[def.kind] ?? def.icon} size={Math.round(size * 0.56)} />
      )}
    </Tile>
  );
}

/* ═══════════════════ Granted tools, as identities ═══════════════════
   A node's grants are capability names. What the eye wants is who they
   belong to: the built-in tool card, or the MCP server. This groups a grant
   list by that identity and carries the risk facts along, so the canvas
   footer, the inspector list and the rail all agree on what a grant looks
   like. */

export interface GrantLook {
  /** `card:<id>` or `server:<id>` — stable across renders. */
  key: string;
  label: string;
  /** Capability names in this group, in grant order. */
  names: string[];
  risk: Risk;
  sink: boolean;
  taints: boolean;
  /** The identity's mark at a size, with an optional hover title. */
  mark: (size: number, title?: string) => ReactNode;
}

export function grantLooks(
  system: AgentSystem,
  names: string[],
  servers?: McpServer[] | null,
): GrantLook[] {
  const out = new Map<string, GrantLook>();
  const bindings = new Map(system.tools.map((t) => [t.name, t]));
  for (const name of names) {
    const cap = BY_NAME.get(name);
    const card = cap ? toolCardOf(name) : undefined;
    const binding = bindings.get(name);
    const risk: Risk = binding?.risk ?? cap?.risk ?? "read";
    const sink = !!(binding?.is_sink ?? cap?.is_sink);
    const taints = !!(binding?.taints ?? cap?.taints);

    let key: string;
    let label: string;
    let mark: GrantLook["mark"];
    if (card) {
      key = `card:${card.id}`;
      label = card.label;
      mark = (size, title) => <ToolMark card={card} size={size} title={title} />;
    } else if (binding) {
      const id = binding.server;
      const lbl = serverLabel(servers, id);
      key = `server:${id}`;
      label = lbl ?? id;
      mark = (size, title) => <ServerMark id={id} label={lbl} size={size} title={title} />;
    } else {
      key = `unknown:${name}`;
      label = name;
      mark = (size, title) => (
        <Tile hue="--t-fg-4" size={size} title={title ?? "Granted but not connected"}>
          <Icon name="plug" size={Math.round(size * 0.56)} />
        </Tile>
      );
    }

    const prev = out.get(key);
    if (prev) {
      prev.names.push(name);
      prev.risk = highestRisk([prev.risk, risk]);
      prev.sink ||= sink;
      prev.taints ||= taints;
    } else {
      out.set(key, { key, label, names: [name], risk, sink, taints, mark });
    }
  }
  return [...out.values()];
}

/** One identity's mark and risk on a single line, for lists. */
export function grantLookOf(
  system: AgentSystem,
  name: string,
  servers?: McpServer[] | null,
): GrantLook {
  return grantLooks(system, [name], servers)[0];
}

/* ═══════════════════ The drag affordance ═══════════════════ */

/** Six dots at the right edge of anything that can be picked up. Faint until
 *  the card is hovered — visible before it is needed, loud only when it is.
 *  Sits in the card's right padding (the card is `relative group`), so it
 *  never takes width from the label. */
export function Grip({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute top-1/2 right-1.5 -translate-y-1/2 text-ghost transition-colors group-hover:text-dim ${className}`}
    >
      <Icon name="grip" size={12} />
    </span>
  );
}

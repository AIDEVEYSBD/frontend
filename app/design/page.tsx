import {
  Avatar,
  Button,
  IconButton,
  Kbd,
  Label,
  Meter,
  Mono,
  Panel,
  Spinner,
  Status,
  Tag,
} from "@/components/ui";
import {
  Checkbox,
  Field,
  Input,
  Radio,
  Segmented,
  Select,
  Switch,
  Tabs,
  Textarea,
} from "@/components/forms";
import {
  Banner,
  Breadcrumb,
  Dialog,
  EmptyState,
  Menu,
  Pagination,
  ReviewerRow,
  Toast,
  Tooltip,
} from "@/components/overlays";
import { Indeterminate, Ring, Skeleton, Thinking } from "@/components/loaders";
import { FilterMenu, ActionMenu } from "@/components/dropdown";
import { Delta, Kpi, Sparkline, BarSpark } from "@/components/data";
import { DataTable } from "@/components/table";
import { EngagementDashboard, OperationsDashboard } from "@/components/dashboard";
import { CAT } from "@/components/charts";
import { MediaHero, MediaCard, MediaVideo, PhotoAvatar, DocThumb } from "@/components/media";
import { RevealShowcase, ScrollArea } from "@/components/scroll";
import { TheaterFrame } from "@/components/theater";
import { NoticeCentre, NoticeRow, NoticeBell, DigestEmail, NoticeSummary, NOTICES } from "@/components/notifications";

export default function DesignPage() {
  return (
    <ScrollArea>
      <div className="w-full px-5 pb-32 pt-12 sm:px-8 lg:px-12 lg:pt-20 2xl:px-20">
        <Masthead />
        <Signature />
        <Principles />
        <MaterialSpec />
        <Type />
        <Color />
        <Categorical />
        <Spacing />
        <Elevation />
        <Buttons />
        <Forms />
        <StatusSystem />
        <Feedback />
        <Notifications />
        <Overlays />
        <Dropdowns />
        <Navigation />
        <Progress />
        <DataDisplay />
        <Tables />
        <Dashboards />
        <MediaSpec />
        <Motion />
        <ScrollSpec />
        <Rejected />
      </div>
    </ScrollArea>
  );
}

/* ═══════════════ Page scaffolding ═══════════════ */

function Section({
  title,
  rationale,
  children,
}: {
  title: string;
  rationale: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-7 border-t border-line py-14 md:grid-cols-[minmax(180px,220px)_1fr] md:gap-12 lg:py-20 2xl:grid-cols-[300px_1fr] 2xl:gap-20">
      <div className="flex flex-col gap-2.5 md:sticky md:top-6 md:self-start">
        <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="max-w-[40ch] text-[13px] leading-[1.6] text-dim">{rationale}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 border-b border-line py-3.5 last:border-0 sm:grid-cols-[110px_1fr] sm:items-baseline sm:gap-5">
      <Label>{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Labelled specimen cell — the unit the component sections are built from. */
function Spec({
  name,
  note,
  children,
  className = "",
}: {
  name: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex min-h-[52px] items-center">{children}</div>
      <div className="flex flex-col gap-0.5 border-t border-line pt-2.5">
        <Mono className="text-[11px]">{name}</Mono>
        {note && <span className="text-[11.5px] leading-snug text-faint">{note}</span>}
      </div>
    </div>
  );
}

/* ═══════════════ Masthead ═══════════════ */

function Masthead() {
  return (
    <header className="flex flex-col gap-8 pb-14 lg:pb-20">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Mono className="text-[11px] text-faint">Agent Factory</Mono>
          <span className="h-px w-8 bg-line-strong" />
          <Mono className="text-[11px] text-faint">v0.3</Mono>
        </div>

        <h1 className="max-w-[16ch] text-[clamp(38px,5.2vw,64px)] leading-[1.02] font-semibold tracking-[-0.035em]">
          A working instrument, built to be looked at.
        </h1>

        <p className="max-w-[64ch] text-[16px] leading-[1.6] text-mist">
          A consultant lives in this product for hours; an executive judges the firm by it
          in ninety seconds. Those two demands pull in opposite directions, and everything
          below is the resolution — density that stays legible, restraint that still reads
          as considered, and colour that means something before it decorates anything.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button tone="ink" variant="solid" size="lg">
          Deploy workflow
        </Button>
        <Button variant="outline" size="lg">
          Run evals
        </Button>
        <span className="ml-1 flex items-center gap-2">
          <Status tone="run">2 running</Status>
          <span className="text-ghost">·</span>
          <Status tone="warn">1 awaiting you</Status>
        </span>
      </div>
    </header>
  );
}

/* ═══════════════ Signature ═══════════════ */

function Signature() {
  return (
    <Section
      title="The signature"
      rationale="One moment carries the product. For an agent platform sold into professional services, that moment is provenance: watching the work happen, and being able to put a finger on the clause behind every sentence it wrote."
    >
      <div className="flex flex-col gap-5">
        <TheaterFrame />

        <div className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2 2xl:grid-cols-4">
          {[
            ["Scrub the run", "The whole view is derived from one timeline, so any second can be reconstructed — there is no separate current state to fall out of sync."],
            ["Every claim cited", "Hover a sentence in the draft and the clause it rests on is highlighted in the original document. An assertion without a source cannot be written."],
            ["Deep-link a moment", "A URL carries a timestamp, so a reviewer opens at the second a decision was made rather than replaying the run."],
            ["Legible under pressure", "Colour marks the kind of event, the spine shows where the run is, and the numbers stay tabular. Dense, but never busy."],
          ].map(([h, d]) => (
            <div key={h} className="flex flex-col gap-1">
              <span className="text-[13px] font-medium">{h}</span>
              <span className="text-[12.5px] leading-[1.6] text-dim">{d}</span>
            </div>
          ))}
        </div>

        <p className="max-w-[70ch] text-[13px] leading-[1.65] text-dim">
          Everything below this exists to make this screen possible. A design system is only
          worth the thing it lets you build — and this is the thing.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Principles ═══════════════ */

const PRINCIPLES = [
  {
    rule: "Neutral carries the interface, colour carries meaning.",
    detail:
      "Roughly 90% of any screen is the neutral ramp. A hue appears only where it denotes a state a person must act on, which is exactly what makes those states findable in a list of two hundred rows.",
  },
  {
    rule: "Depth comes from the smallest signal that works.",
    detail:
      "A background step first, a hairline second, a shadow only when a surface genuinely floats. Shadows are invisible on dark, so elevation there is a lighter surface instead.",
  },
  {
    rule: "Every control has six states.",
    detail:
      "Default, hover, focus, active, disabled, loading. A control missing one is unfinished — this is the practical line between production software and a mockup of it.",
  },
  {
    rule: "Motion explains a change or it does not ship.",
    detail:
      "Entrances 200–260ms and decelerating, exits faster. Nothing loops for decoration. Reduced-motion is an off switch, never a shorter duration.",
  },
];

function Principles() {
  return (
    <Section title="Principles" rationale="Four rules that settle most arguments before they start.">
      <ol className="grid grid-cols-1 gap-7 2xl:grid-cols-2 2xl:gap-x-16">
        {PRINCIPLES.map((p, i) => (
          <li key={p.rule} className="flex gap-4">
            <Mono className="shrink-0 pt-1 text-[11px] text-ghost">
              {String(i + 1).padStart(2, "0")}
            </Mono>
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] font-medium tracking-[-0.005em]">{p.rule}</span>
              <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
                {p.detail}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ═══════════════ Material ═══════════════ */

function MaterialSpec() {
  const grain =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E\")";

  return (
    <Section
      title="Material"
      rationale="The ground is not a flat fill. Two achromatic layers give it tooth and a light direction — the difference between a surface and a colour value. Both are near-invisible alone, which is the test they have to pass."
    >
      <div className="flex flex-col gap-7">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            {
              n: "grain",
              v: "2.5% light · 4% dark",
              d: "Fractal noise, fully desaturated. Removes the plastic flatness of a solid fill.",
              style: { backgroundColor: "var(--t-surface)", backgroundImage: grain },
            },
            {
              n: "cast",
              v: "one direction, from above",
              d: "A single neutral tonal lift, so every shadow in the system agrees with its ground.",
              style: { background: "var(--material-cast), var(--t-raise)" },
            },
            {
              n: "composite",
              v: "what you are looking at",
              d: "Applied once at the app shell, fixed behind everything, never per panel.",
              style: { backgroundColor: "var(--t-canvas)" },
            },
          ].map((m) => (
            <div key={m.n} className="flex flex-col gap-3">
              <div
                className="h-24 rounded-lg border border-line"
                style={m.style as React.CSSProperties}
              />
              <div className="flex flex-col gap-0.5 border-t border-line pt-2.5">
                <div className="flex items-baseline gap-2">
                  <Mono className="text-[11px]">{m.n}</Mono>
                  <span className="text-[10.5px] text-ghost">{m.v}</span>
                </div>
                <span className="text-[11.5px] leading-snug text-faint">{m.d}</span>
              </div>
            </div>
          ))}
        </div>

        <p className="max-w-[70ch] text-[13px] leading-[1.65] text-dim">
          What separates this from the glow treatment it replaced: no hue, no radius, no
          shape you could point at. Grain and a light direction are what print has and a
          flat screen fill does not. A coloured bloom behind a hero is decoration standing
          in for depth.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Typography ═══════════════ */

const SCALE = [
  { name: "hero", px: 64, weight: 600, tracking: "-0.035em", use: "One per product surface" },
  { name: "display", px: 28, weight: 600, tracking: "-0.02em", use: "Page titles" },
  { name: "title", px: 20, weight: 600, tracking: "-0.015em", use: "Section headings" },
  { name: "subtitle", px: 15, weight: 600, tracking: "-0.005em", use: "Panel headings" },
  { name: "body", px: 14, weight: 400, tracking: "0", use: "Default interface text" },
  { name: "secondary", px: 13, weight: 400, tracking: "0", use: "Supporting prose" },
  { name: "caption", px: 12, weight: 400, tracking: "0", use: "Metadata, table cells" },
  { name: "micro", px: 11, weight: 500, tracking: "0", use: "Labels, status" },
];

function Type() {
  return (
    <Section
      title="Typography"
      rationale="One family for the interface, one for machine output. Tracking tightens as size grows and opens as it shrinks — the single adjustment that separates typeset text from default text."
    >
      <div className="flex flex-col gap-10">
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[460px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line">
                {["Token", "Size", "Wt", "Tracking", "Specimen"].map((h) => (
                  <th key={h} className="pb-2.5 text-[11px] font-medium text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SCALE.map((s) => (
                <tr key={s.name} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 align-middle">
                    <Mono className="text-[11px]">{s.name}</Mono>
                  </td>
                  <td className="tnum py-3 pr-4 align-middle font-mono text-[11px] text-faint">
                    {s.px}
                  </td>
                  <td className="tnum py-3 pr-4 align-middle font-mono text-[11px] text-faint">
                    {s.weight}
                  </td>
                  <td className="tnum py-3 pr-5 align-middle font-mono text-[11px] text-ghost">
                    {s.tracking}
                  </td>
                  <td className="py-3 align-middle">
                    <span
                      className="block truncate"
                      style={{
                        fontSize: Math.min(s.px, 34),
                        fontWeight: s.weight,
                        letterSpacing: s.tracking,
                        lineHeight: 1.2,
                      }}
                    >
                      {s.use}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col">
          <Row label="Measure">
            <p className="max-w-[65ch] text-[13px] leading-[1.65] text-mist">
              Body prose is capped at 65 characters. Past roughly 75 the eye loses the start
              of the next line; below 45 it jumps too often. This paragraph sits at the cap,
              so you are reading the target width right now.
            </p>
          </Row>
          <Row label="Leading">
            <span className="text-[13px] text-dim">
              1.65 prose · 1.5 interface · 1.2 headings · 1.3 table rows. Leading tightens as
              size grows.
            </span>
          </Row>
          <Row label="Weights">
            <span className="text-[13px] text-dim">
              <span className="font-normal">400 regular</span> ·{" "}
              <span className="font-medium">500 medium</span> ·{" "}
              <span className="font-semibold">600 semibold</span>. No 700 anywhere — emphasis
              is one weight step, not a jump to bold.
            </span>
          </Row>
          <Row label="Numerals">
            <div className="flex flex-col gap-1">
              <span className="tnum font-mono text-[14px]">214 · 04:12 · $0.84 · 96.4%</span>
              <span className="text-[12px] text-faint">
                Tabular figures anywhere a number can land in a column.
              </span>
            </div>
          </Row>
          <Row label="Mono">
            <div className="flex flex-col gap-1">
              <Mono className="text-[13px]">policy_db.lookup(claim=&quot;CL-88213&quot;)</Mono>
              <span className="text-[12px] text-faint">
                Machine output only: identifiers, tool calls, durations, code.
              </span>
            </div>
          </Row>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Color ═══════════════ */

const NEUTRALS = [
  { token: "canvas", var: "--t-canvas" },
  { token: "surface", var: "--t-surface" },
  { token: "raise", var: "--t-raise" },
  { token: "sunken", var: "--t-sunken" },
  { token: "line", var: "--t-line" },
  { token: "line-strong", var: "--t-line-strong" },
];

const TEXTS = [
  { token: "fg", var: "--t-fg", use: "Primary text" },
  { token: "mist", var: "--t-fg-2", use: "Body prose" },
  { token: "dim", var: "--t-fg-3", use: "Secondary" },
  { token: "faint", var: "--t-fg-4", use: "Labels" },
  { token: "ghost", var: "--t-fg-5", use: "Disabled" },
];

const SEMANTICS = [
  { token: "run", var: "--t-run", meaning: "In flight — a harness is working" },
  { token: "ok", var: "--t-ok", meaning: "Passed, approved, complete" },
  { token: "warn", var: "--t-warn", meaning: "Below threshold, needs a human" },
  { token: "err", var: "--t-err", meaning: "Failed, aborted" },
  { token: "queue", var: "--t-queue", meaning: "Queued, informational" },
];

function Palette({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      data-theme={theme}
      className="flex flex-col gap-4 rounded-lg border border-line bg-canvas p-5"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-fg capitalize">{theme}</span>
        <Mono className="text-[10.5px] text-faint">
          {theme === "light" ? "#FBFAF9" : "#0A0A09"}
        </Mono>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {NEUTRALS.map((n) => (
          <div key={n.token} className="flex items-center gap-2.5">
            <span
              className="size-5 shrink-0 rounded-xs border border-line-strong"
              style={{ background: `var(${n.var})` }}
            />
            <Mono className="truncate text-[10.5px] text-dim">{n.token}</Mono>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-3">
        {TEXTS.map((t) => (
          <span key={t.token} className="text-[12px]" style={{ color: `var(${t.var})` }}>
            {t.token} — {t.use}
          </span>
        ))}
      </div>

      {/* Solid fills with contrasting text — the same treatment buttons use. */}
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
        {SEMANTICS.map((s) => (
          <span
            key={s.token}
            className="rounded-sm px-2 py-1 text-[10.5px] font-medium"
            style={{ background: `var(${s.var})`, color: "var(--t-on-solid)" }}
          >
            {s.token}
          </span>
        ))}
      </div>
    </div>
  );
}

function Color() {
  return (
    <Section
      title="Colour"
      rationale="A warm neutral ramp does the work; one amber-ochre accent means work in flight and nothing else is permitted to use it. Deliberately not the indigo-violet that ships as a framework default."
    >
      <div className="flex flex-col gap-7">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Palette theme="light" />
          <Palette theme="dark" />
        </div>

        <div className="flex flex-col">
          {SEMANTICS.map((s) => (
            <div
              key={s.token}
              className="grid grid-cols-[70px_1fr] items-center gap-4 border-b border-line py-3 last:border-0 sm:grid-cols-[90px_1fr]"
            >
              <Mono className="text-[11px]">{s.token}</Mono>
              <span className="text-[13px] text-dim">{s.meaning}</span>
            </div>
          ))}
        </div>

        <p className="max-w-[70ch] text-[13px] leading-[1.65] text-dim">
          Dark is not the light palette inverted. Accents lighten and desaturate by roughly a
          quarter, because a fully saturated hue vibrates against a dark ground; the base is{" "}
          <Mono className="text-[12px]">#0A0A09</Mono> rather than black so surfaces above it
          still have somewhere to go. Solid fills flip their text to the theme&rsquo;s
          contrasting ground, which keeps every one of them past 4.5:1 in both themes.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Categorical ═══════════════ */

const CATEGORIES = [
  { n: "c1", use: "Extraction" },
  { n: "c2", use: "Research" },
  { n: "c3", use: "Drafting" },
  { n: "c4", use: "Review" },
  { n: "c5", use: "Routing" },
  { n: "c6", use: "Decision" },
  { n: "c7", use: "Escalation" },
  { n: "c8", use: "Retry" },
  { n: "c9", use: "Gate" },
  { n: "c10", use: "Integration" },
];

function Categorical() {
  return (
    <Section
      title="Categorical"
      rationale="Ten pre-muted hues for things that differ in kind rather than in severity — chart series, harness types, engagements, tags. Every one is drawn from this set, which is precisely what stops a dense view turning into a rainbow."
    >
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <div key={c.n} className="flex flex-col gap-2">
              <span
                className="h-14 rounded-md border border-line"
                style={{ background: CAT[i] }}
              />
              <div className="flex flex-col gap-0.5">
                <Mono className="text-[10.5px]">{c.n}</Mono>
                <span className="text-[11px] text-faint">{c.use}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c, i) => (
            <span
              key={c.n}
              className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-raise px-2 py-1 text-[11.5px] font-medium"
            >
              <span className="size-2 rounded-[2px]" style={{ background: CAT[i] }} />
              {c.use}
            </span>
          ))}
        </div>

        <p className="max-w-[70ch] text-[13px] leading-[1.65] text-dim">
          These are for <em>kind</em>, never for <em>state</em>. A run is amber because it is
          working, not because amber is its turn in the rotation — and a category never
          borrows a semantic hue to mean something else. Each has a separate light and dark
          value: darker and more saturated on light grounds, lifted and desaturated on dark.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Spacing ═══════════════ */

function Spacing() {
  return (
    <Section
      title="Spacing & shape"
      rationale="A 4px base. Steps grow proportionally so adjacent values stay visually distinct — a linear scale stops reading as different past the small end."
    >
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-2">
          {[4, 8, 12, 16, 24, 32, 48, 64, 96].map((s) => (
            <div key={s} className="flex items-center gap-4">
              <span className="tnum w-8 font-mono text-[11px] text-faint">{s}</span>
              <span className="h-3.5 rounded-xs bg-raise" style={{ width: s * 2 }} />
            </div>
          ))}
        </div>

        <div className="flex flex-col">
          <Row label="Grouping">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Space around a group always exceeds space within it. If the gap between a label
              and its field ever matches the gap to the next field, the grouping has stopped
              working — this one rule fixes most layouts that feel disorganised.
            </span>
          </Row>
          <Row label="Radius">
            <div className="flex flex-wrap items-center gap-5">
              {[
                { r: "3px", n: "xs" },
                { r: "4px", n: "sm" },
                { r: "6px", n: "md" },
                { r: "8px", n: "lg" },
                { r: "12px", n: "xl" },
              ].map((x) => (
                <div key={x.n} className="flex items-center gap-2">
                  <span
                    className="size-9 border border-line-strong bg-raise"
                    style={{ borderRadius: x.r }}
                  />
                  <Mono className="text-[10.5px]">{x.n}</Mono>
                </div>
              ))}
            </div>
          </Row>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Elevation ═══════════════ */

function Elevation() {
  return (
    <Section
      title="Elevation"
      rationale="Four levels, and most of the interface never leaves the first two. Shadows are layered and tinted with the ground hue rather than black, so they read as light instead of grey smudge."
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {[
            { n: "flat", c: "", d: "Rows, inline groups" },
            { n: "elev-1", c: "elev-1", d: "Panels, cards" },
            { n: "elev-2", c: "elev-2", d: "Popovers, menus" },
            { n: "elev-3", c: "elev-3", d: "Dialogs, toasts" },
          ].map((e) => (
            <div key={e.n} className="flex flex-col gap-3">
              <div className={`h-20 rounded-lg border border-line bg-surface ${e.c}`} />
              <div className="flex flex-col gap-0.5 border-t border-line pt-2.5">
                <Mono className="text-[11px]">{e.n}</Mono>
                <span className="text-[11.5px] text-faint">{e.d}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="max-w-[70ch] text-[13px] leading-[1.65] text-dim">
          A shadow is invisible on a dark ground, so the same four levels are expressed there
          as progressively lighter surfaces. Switch the theme and watch this row: identical
          geometry, different mechanism.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Buttons ═══════════════ */

const TONES = [
  { tone: "ink", label: "Deploy", note: "Primary action. One per screen." },
  { tone: "run", label: "Start run", note: "Begins work that will take time." },
  { tone: "ok", label: "Approve", note: "Confirms, signs off, releases a gate." },
  { tone: "warn", label: "Override", note: "Proceeds past a threshold deliberately." },
  { tone: "err", label: "Abort run", note: "Destroys work or stops it hard." },
] as const;

function Buttons() {
  return (
    <Section
      title="Buttons"
      rationale="Every button is a solid fill with text that contrasts the mode; nothing is transparent. Tone fills mark a consequential action so it is unmistakable at a glance. Outline and quiet variants are filled on the neutral ramp, so they sit beside one without competing."
    >
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-5">
          <Label>Solid — the action is the point</Label>
          <div className="flex flex-wrap items-center gap-2.5">
            {TONES.map((t) => (
              <Button key={t.tone} tone={t.tone} variant="solid">
                {t.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 2xl:grid-cols-3">
            {TONES.map((t) => (
              <div key={t.tone} className="flex items-baseline gap-2.5">
                <Mono className="w-12 shrink-0 text-[10.5px]">{t.tone}</Mono>
                <span className="text-[12px] text-faint">{t.note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Label>Outline — surface fill with a hairline, beside a solid without competing</Label>
          <div className="flex flex-wrap items-center gap-2.5">
            {TONES.map((t) => (
              <Button key={t.tone} tone={t.tone} variant="outline">
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Label>Quiet — raise fill, for tertiary actions and dense toolbars</Label>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="quiet">Cancel</Button>
            <Button variant="quiet" tone="ink">
              View trace
            </Button>
            <Button variant="quiet" tone="err">
              Remove
            </Button>
            <div className="ml-2 flex items-center gap-1">
              {[
                <path key="a" d="M12 5v14M5 12h14" />,
                <path key="b" d="M4 6h16M4 12h16M4 18h10" />,
                <g key="c">
                  <circle cx="12" cy="5" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="12" cy="19" r="1.6" />
                </g>,
              ].map((d, i) => (
                <IconButton key={i} label={`Action ${i + 1}`}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    {d}
                  </svg>
                </IconButton>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Label>Six states, every variant</Label>
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[600px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {["Variant", "Default", "Hover", "Focus", "Active", "Disabled", "Loading"].map(
                    (h) => (
                      <th key={h} className="pb-2.5 text-[11px] font-medium text-faint">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    { v: "solid", tone: "ink", label: "Deploy", h: "brightness-110", a: "brightness-90" },
                    { v: "solid", tone: "err", label: "Abort", h: "brightness-110", a: "brightness-90" },
                    { v: "outline", tone: "ink", label: "Run evals", h: "bg-raise", a: "bg-sunken" },
                    { v: "quiet", tone: "neutral", label: "Cancel", h: "bg-raise text-fg", a: "bg-sunken text-fg" },
                  ] as const
                ).map((r) => (
                  <tr key={`${r.v}-${r.tone}`} className="border-b border-line last:border-0">
                    <td className="py-3.5 pr-5">
                      <Mono className="text-[11px]">
                        {r.v}·{r.tone}
                      </Mono>
                    </td>
                    {[
                      "",
                      r.h,
                      "outline-2 outline-offset-2 outline-fg",
                      r.a,
                      "",
                      "",
                    ].map((cls, i) => (
                      <td key={i} className="py-3.5 pr-3">
                        <Button
                          tone={r.tone}
                          variant={r.v}
                          size="sm"
                          className={cls}
                          disabled={i === 4}
                          loading={i === 5}
                        >
                          {r.label}
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Label>Sizes</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Button tone="ink" variant="solid" size="sm">
              Small
            </Button>
            <Button tone="ink" variant="solid" size="md">
              Medium
            </Button>
            <Button tone="ink" variant="solid" size="lg">
              Large
            </Button>
            <span className="ml-2 flex items-center gap-2 text-[12px] text-faint">
              28 · 36 · 44px — the last clears the 44px touch minimum.
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Forms ═══════════════ */

function Forms() {
  return (
    <Section
      title="Forms"
      rationale="Every field is a label, a control, and one line of help or error — never a control alone. Focus is a visible ring on all of them, and error state is carried by border, text and icon rather than colour alone."
    >
      <div className="flex flex-col gap-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
          <Field label="Workflow name" hint="Shown to reviewers in the run list.">
            <Input defaultValue="Claims Intake" />
          </Field>
          <Field label="Confidence gate" hint="Runs below this escalate to a human.">
            <Input prefix="≥" defaultValue="0.85" />
          </Field>
          <Field label="Escalation contact" error="This reviewer is no longer on the engagement.">
            <Input defaultValue="j.hale@example.com" invalid />
          </Field>
          <Field label="Model" hint="Applies to every harness unless overridden.">
            <Select options={["claude-fable-5", "claude-opus-5", "claude-sonnet-5"]} />
          </Field>
          <Field label="Locked field" hint="Set by the engagement template.">
            <Input defaultValue="EY Advisory — sandbox" disabled />
          </Field>
          <Field label="Reviewer note" hint="Included in the audit record.">
            <Textarea placeholder="Add context for whoever approves this run…" />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 2xl:grid-cols-4">
          <div className="flex flex-col gap-4">
            <Label>Checkbox</Label>
            <Checkbox label="Require human approval" defaultChecked />
            <Checkbox label="Redact PII before tool calls" defaultChecked />
            <Checkbox label="Partial selection" indeterminate />
            <Checkbox label="Unavailable here" disabled />
          </div>

          <div className="flex flex-col gap-4">
            <Label>Radio</Label>
            <Radio
              name="On failure"
              options={["Escalate to a human", "Retry once, then escalate", "Abort the run"]}
            />
          </div>

          <div className="flex flex-col gap-4">
            <Label>Switch</Label>
            <Switch label="Run evals before deploy" defaultChecked />
            <Switch label="Notify on escalation" />
            <Switch label="Locked by policy" disabled />
          </div>

          <div className="flex flex-col gap-4">
            <Label>Segmented</Label>
            <Segmented options={["All", "Running", "Mine"]} />
            <span className="text-[12px] leading-snug text-faint">
              For two to four mutually exclusive filters. Beyond four, use a select.
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Label>Tabs</Label>
          <Tabs
            tabs={["Overview", "Harnesses", "Evals", "Audit"]}
            panels={Object.fromEntries(
              ["Overview", "Harnesses", "Evals", "Audit"].map((t) => [
                t,
                <div
                  key={t}
                  className="rounded-lg border border-line bg-raise px-4 py-6 text-[13px] text-dim"
                >
                  {t} panel content
                </div>,
              ]),
            )}
          />
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Status ═══════════════ */

function StatusSystem() {
  return (
    <Section
      title="Status"
      rationale="Colour, a dot, and a word — three redundant signals, so state survives greyscale printing and colour-blindness. Status is never colour alone, and never a tinted panel."
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <Status tone="run">Running</Status>
          <Status tone="ok">Passed</Status>
          <Status tone="warn">Needs review</Status>
          <Status tone="err">Failed</Status>
          <Status tone="queue">Queued</Status>
          <Status tone="neutral">Draft</Status>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="run" solid>
            run
          </Tag>
          <Tag tone="ok" solid>
            approved
          </Tag>
          <Tag tone="err" solid>
            blocked
          </Tag>
          <Tag>extraction</Tag>
          <Tag>decision</Tag>
          <Tag>gate</Tag>
        </div>

        <Panel className="divide-y divide-line overflow-hidden">
          {[
            { id: "4128", s: "CL-88213 · R. Alvarez", tone: "run", l: "Running", t: "04:12" },
            { id: "4127", s: "CL-88209 · M. Okafor", tone: "warn", l: "Needs review", t: "06:41" },
            { id: "4126", s: "Nordic Energy — audit", tone: "queue", l: "Queued", t: "12:08" },
            { id: "4125", s: "CL-88204 · T. Lindqvist", tone: "ok", l: "Passed", t: "05:02" },
          ].map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[52px_1fr_auto] items-center gap-3 px-4 py-3 text-[13px] transition-colors hover:bg-raise sm:grid-cols-[64px_1fr_auto_64px] sm:gap-5"
            >
              <Mono className="text-[11px] text-faint">{r.id}</Mono>
              <span className="truncate">{r.s}</span>
              <Status tone={r.tone as "run"}>{r.l}</Status>
              <span className="tnum hidden text-right font-mono text-[11px] text-faint sm:block">
                {r.t}
              </span>
            </div>
          ))}
        </Panel>
      </div>
    </Section>
  );
}

/* ═══════════════ Feedback ═══════════════ */

function Feedback() {
  return (
    <Section
      title="Feedback"
      rationale="Banners sit in the flow and persist; toasts float and expire. Both carry tone on a solid edge rather than tinting the surface behind their text."
    >
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-4">
          <Label>Banners</Label>
          <Banner
            tone="warn"
            title="Confidence fell below the gate"
            action={<Button size="sm" tone="warn" variant="solid">Review</Button>}
          >
            Run 4127 returned 0.71 against a 0.85 threshold. It is parked until a reviewer
            signs off.
          </Banner>
          <Banner tone="ok" title="Evals passed on all 84 cases">
            Claims Intake is clear to deploy. Last run 6 minutes ago.
          </Banner>
          <Banner
            tone="err"
            title="Two harnesses failed to reach the policy database"
            action={<Button size="sm" tone="err" variant="solid">Retry</Button>}
          >
            The connection timed out after three attempts. Runs in flight were parked rather
            than failed.
          </Banner>
          <Banner tone="queue" title="Scheduled maintenance on Saturday, 02:00–04:00 UTC">
            Runs queued during the window start when it closes.
          </Banner>
        </div>

        <div className="flex flex-col gap-4">
          <Label>Toasts</Label>
          <div className="flex flex-col gap-3">
            <Toast title="Workflow deployed" detail="Claims Intake · version 12" tone="ok" />
            <Toast title="Running evals…" detail="34 of 84 cases" loading />
            <Toast title="Could not save" detail="Your session expired. Sign in again." tone="err" />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Notifications ═══════════════ */

function Notifications() {
  return (
    <Section
      title="Notifications"
      rationale="One sentence structure everywhere — who did what to which thing, then when. The subject is always a named actor, never “the system”, because the reader needs to know who to ask."
    >
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <Label>Anatomy — a single notification</Label>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {NOTICES.slice(0, 3).map((n) => (
              <div key={n.id} className="border-b border-line last:border-0">
                <NoticeRow n={n} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-x-10 gap-y-2 sm:grid-cols-2 2xl:grid-cols-4">
            {[
              ["Unread is a rule, not a wash", "A tinted row stops being readable once three of them stack."],
              ["Actor first", "A named person or a named harness — the thing you would go and ask."],
              ["One action, at most", "If a notification needs two buttons it is really two notifications."],
              ["Relative time", "Age is what matters against an SLA; the absolute stamp lives in the trace."],
            ].map(([h, d]) => (
              <div key={h} className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium">{h}</span>
                <span className="text-[11.5px] leading-[1.55] text-dim">{d}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <Label>Notification centre</Label>
            <NoticeCentre />
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <Label>Trigger &amp; inline summary</Label>
              <div className="flex items-center gap-4 rounded-md border border-line bg-surface px-3 py-2">
                <NoticeBell />
                <span className="text-[12px] text-faint">
                  Count is a squared marker — never a pill.
                </span>
              </div>
              <NoticeSummary />
            </div>

            <div className="flex flex-col gap-4">
              <Label>Daily digest — the same format, by email</Label>
              <DigestEmail />
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <Row label="Escalation">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Anything that blocks a run reaches a person by the channel they chose within
              the SLA, and keeps reaching the next approver until it is acknowledged. A
              notification nobody reads is an outage nobody noticed.
            </span>
          </Row>
          <Row label="Never">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Notifying on success at volume, badge counts that include things needing no
              action, or a toast for anything the person themselves just did.
            </span>
          </Row>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Overlays ═══════════════ */

function Overlays() {
  return (
    <Section
      title="Overlays"
      rationale="Anything that floats sits at elev-3 with a hairline, because a shadow alone will not separate it from a dark ground. Dialogs state a consequence before they ask for a decision."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr] lg:gap-12">
        <div className="flex flex-col gap-8">
          <Spec name="menu" note="Row actions, canvas nodes.">
            <Menu />
          </Spec>
          <Spec name="tooltip" note="Names a control; never holds essential information.">
            <div className="flex items-center gap-3">
              <Tooltip>Pause after the current step</Tooltip>
              <Tooltip>⌘ + Enter</Tooltip>
            </div>
          </Spec>
        </div>

        <div className="flex flex-col gap-8">
          <Spec name="dialog" note="Names the consequence and the evidence before the action.">
            <Dialog />
          </Spec>
          <Spec name="empty" note="Says what goes here and offers the first step.">
            <EmptyState
              title="No runs yet"
              detail="When a workflow executes, every run and its full trace appears here."
              action={
                <Button size="sm" tone="ink" variant="solid">
                  Start a run
                </Button>
              }
            />
          </Spec>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Navigation ═══════════════ */

function Navigation() {
  return (
    <Section
      title="Navigation & identity"
      rationale="Small pieces, but they are what make a product feel finished. Keyboard hints appear next to anything a frequent user will stop clicking."
    >
      <div className="flex flex-col gap-9">
        <Spec name="breadcrumb" note="Position in the hierarchy; the last item is the page.">
          <Breadcrumb path={["Workflows", "Claims Intake", "Validate coverage"]} />
        </Spec>

        <Spec name="pagination" note="Range first, controls second.">
          <Pagination />
        </Spec>

        <Spec name="reviewer" note="Identity beside the action it gates.">
          <div className="w-full max-w-[420px]">
            <ReviewerRow />
          </div>
        </Spec>

        <Spec name="avatars · kbd" note="Initials only — never a generated illustration.">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center -space-x-1.5">
              {["Sana Rahman", "Tom Okafor", "Lea Vogt"].map((n) => (
                <Avatar key={n} name={n} />
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-dim">
              Approve
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </div>
          </div>
        </Spec>
      </div>
    </Section>
  );
}

/* ═══════════════ Progress ═══════════════ */

function Progress() {
  return (
    <Section
      title="Progress"
      rationale="Chosen by what is known. Duration known: a ring or meter. Unknown: the indeterminate bar. Thinking is reserved for a model actively reasoning and is the only indicator that loops in the accent."
    >
      <div className="flex flex-col divide-y divide-line">
        {[
          { el: <Spinner size={15} />, n: "spinner", d: "Inline, inside a control that is working." },
          { el: <Thinking />, n: "thinking", d: "A harness is reasoning." },
          { el: <Indeterminate className="w-44" />, n: "indeterminate", d: "Unknown duration — queued runs, long batches." },
          {
            el: (
              <div className="flex items-center gap-4">
                <Ring value={0.96} tone="ok" />
                <Ring value={0.62} />
              </div>
            ),
            n: "ring",
            d: "Known completion. Eval suites, batch progress.",
          },
          { el: <Skeleton lines={3} />, n: "skeleton", d: "An artifact is being written into a panel." },
        ].map((x) => (
          <div
            key={x.n}
            className="grid grid-cols-1 items-start gap-3 py-5 sm:grid-cols-[minmax(160px,200px)_1fr] sm:items-center sm:gap-8"
          >
            <div className="flex min-h-[36px] items-center">{x.el}</div>
            <div className="flex flex-col gap-0.5">
              <Mono className="text-[11px]">{x.n}</Mono>
              <span className="text-[12.5px] leading-snug text-dim">{x.d}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ═══════════════ Data ═══════════════ */

function DataDisplay() {
  return (
    <Section
      title="Data"
      rationale="Numbers are the product, so they get tabular figures, real size, and a qualifier beside them. A figure without its unit or comparison is not finished."
    >
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Eval pass rate", v: "96.4", u: "%", sub: "84 cases", m: 0.964, tone: "ok" },
            { label: "Confidence", v: "0.71", u: "", sub: "below 0.85 gate", m: 0.71, tone: "warn" },
            { label: "Runs today", v: "214", u: "", sub: "+18% vs 7d avg", m: 0.62, tone: "run" },
            { label: "Cost per run", v: "0.84", u: "$", sub: "−6% vs 7d avg", m: 0.4, tone: "queue" },
          ].map((s) => (
            <Panel key={s.label} className="flex flex-col gap-3.5 p-4">
              <Label>{s.label}</Label>
              <div className="flex items-baseline gap-1">
                <span className="tnum text-[28px] leading-none font-semibold tracking-[-0.025em]">
                  {s.v}
                </span>
                <span className="text-[15px] text-dim">{s.u}</span>
              </div>
              <Meter value={s.m} tone={s.tone as "ok"} />
              <span className="text-[11.5px] text-faint">{s.sub}</span>
            </Panel>
          ))}
        </div>

        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                {["Harness", "Kind", "Cases", "Pass", "p50", "Used by"].map((h) => (
                  <th key={h} className="pb-2.5 text-[11px] font-medium text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Document extraction", "extraction", 84, "96.4%", "1.2s", 7],
                ["Rule decision", "decision", 112, "94.1%", "0.8s", 6],
                ["Compliance review", "review", 73, "98.6%", "2.4s", 6],
                ["Document drafting", "drafting", 47, "89.3%", "4.1s", 8],
              ].map((r) => (
                <tr
                  key={r[0] as string}
                  className="border-b border-line transition-colors last:border-0 hover:bg-raise"
                >
                  <td className="py-3 pr-5 text-[13px] font-medium">{r[0]}</td>
                  <td className="py-3 pr-5">
                    <Tag>{r[1]}</Tag>
                  </td>
                  <td className="tnum py-3 pr-5 font-mono text-[12px] text-dim">{r[2]}</td>
                  <td className="tnum py-3 pr-5 font-mono text-[12px] text-dim">{r[3]}</td>
                  <td className="tnum py-3 pr-5 font-mono text-[12px] text-dim">{r[4]}</td>
                  <td className="tnum py-3 font-mono text-[12px] text-dim">{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Motion ═══════════════ */

function Motion() {
  return (
    <Section
      title="Motion"
      rationale="Two curves and three durations. Entrances decelerate so the eye can follow; exits accelerate away because a departing element no longer needs tracking."
    >
      <div className="flex flex-col">
        <Row label="100ms">
          <span className="text-[13px] text-dim">Micro-feedback — press, toggle, hover colour.</span>
        </Row>
        <Row label="200ms">
          <span className="text-[13px] text-dim">Standard — menu, tooltip, panel reveal.</span>
        </Row>
        <Row label="260ms">
          <span className="text-[13px] text-dim">
            Substantial — dialog, route change, scroll reveal. Nothing exceeds 300ms.
          </span>
        </Row>
        <Row label="ease-out">
          <Mono className="text-[12px]">cubic-bezier(0.4, 0, 0.2, 1)</Mono>
        </Row>
        <Row label="ease-in">
          <Mono className="text-[12px]">cubic-bezier(0.4, 0, 1, 1)</Mono>
        </Row>
        <Row label="Never">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            Spring overshoot on routine controls, motion on high-frequency actions, or
            anything that loops without representing live state.
          </span>
        </Row>
      </div>
    </Section>
  );
}

/* ═══════════════ Scroll ═══════════════ */

function ScrollSpec() {
  return (
    <Section
      title="Scroll"
      rationale="A local device, not a page treatment. It belongs where content genuinely arrives — a streaming result list, a panel filling in — and nowhere else."
    >
      <div className="flex flex-col gap-8">
        <RevealShowcase
          items={[
            { title: "Extract completed", meta: "14 fields · 3 documents · 1:04" },
            { title: "policy_db.lookup", meta: "200 · 0.4s · policy 88-4417" },
            { title: "Coverage evaluated", meta: "§4.2 water damage · rider applies" },
            { title: "Prior claims searched", meta: "2 matches in 36 months" },
            { title: "Draft response written", meta: "620 words · 4 citations" },
            { title: "Compliance review", meta: "12 controls · 0 findings" },
            { title: "Escalated to reviewer", meta: "confidence 0.71 · below gate" },
            { title: "Approved by S. Rahman", meta: "06:41 elapsed · $1.12" },
          ]}
        />

      <div className="flex flex-col">
        <Row label="Reveal">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            Sections fade and rise 10px over 260ms on entry, the specimen column trailing its
            heading by 60ms. Enough to feel the page assemble; never enough to make anyone
            wait for text already on screen.
          </span>
        </Row>
        <Row label="Reverse">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            Scrolling back up resets a section so it plays again on re-entry. Elements that
            leave upward are deliberately left alone — fading content as it scrolls off the
            top reads as a rendering fault rather than an effect.
          </span>
        </Row>
        <Row label="Robust">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            Content ships visible and is hidden only once scripting confirms it can animate.
            If JavaScript fails, the page reads normally instead of being stranded blank.
          </span>
        </Row>
        <Row label="Never">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            Inside the product: scroll-jacking, parallax, pinned sections, horizontal hijack,
            or motion tied to cursor position. A console is operated, not toured.
          </span>
        </Row>
        <Row label="Marketing shell">
          <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
            The landing page is the one surface that tells a story, and it may pin a scene
            while scroll advances it, loop an illustrative vignette, run an editorial hero
            and lay equal tiles in a grid. Three conditions hold: content ships visible and
            reads in normal flow without scripting, reduced motion releases every pin and
            stops every loop, and the accent, type floor and token rules still apply.
          </span>
        </Row>
      </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Dropdowns ═══════════════ */

function Dropdowns() {
  return (
    <Section
      title="Dropdowns"
      rationale="Three jobs, three shapes: pick one value, filter by many, or act on a row. All dismiss on Escape and on a click outside, and all sit at elev-3 with a hairline."
    >
      <div className="flex flex-col gap-10">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label>Select — one value</Label>
            <div className="w-[230px]">
              <Select
                options={["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4.5"]}
                aria-label="Model"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Filter — many values</Label>
            <FilterMenu
              label="Status"
              options={["Running", "Needs review", "Passed", "Failed", "Queued"]}
              defaultSelected={["Running", "Needs review"]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Actions — on a row</Label>
            <div className="flex h-9 items-center rounded-md border border-line bg-surface px-2">
              <ActionMenu
                align="left"
                items={[
                  { label: "Open run", kbd: "↵" },
                  { label: "View trace", kbd: "T" },
                  { label: "Duplicate", kbd: "D" },
                ]}
                destructive="Abort run"
              />
            </div>
          </div>
        </div>

        <p className="max-w-[68ch] text-[13px] leading-[1.65] text-dim">
          Open one and the trigger chevron rotates rather than swapping glyphs, so the
          control reads as the same object in two states. Selection is confirmed with a
          check on the row, never by colour alone.
        </p>
      </div>
    </Section>
  );
}

/* ═══════════════ Tables ═══════════════ */

function Tables() {
  return (
    <Section
      title="Tables"
      rationale="The densest surface in the product, so it gets the most rules: sticky header, sortable columns, right-aligned tabular numerals, row actions that appear on hover, and a bulk bar that replaces the header rather than stacking on it."
    >
      <div className="flex flex-col gap-8">
        <DataTable />

        <div className="flex flex-col">
          <Row label="Sorting">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              The active column shows its direction permanently; inactive columns reveal a
              chevron on hover, so the header is not a wall of arrows.
            </span>
          </Row>
          <Row label="Selection">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Tick a row and the toolbar becomes a bulk bar in place. Nothing shifts
              vertically, so the row you were aiming at does not move.
            </span>
          </Row>
          <Row label="Numbers">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Right-aligned and tabular. Confidence below the gate turns amber — the one
              place a table cell is allowed to carry a hue.
            </span>
          </Row>
          <Row label="Actions">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Hidden until hover or keyboard focus. Always reachable by tab, never a
              hover-only affordance.
            </span>
          </Row>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Dashboards ═══════════════ */

function Dashboards() {
  return (
    <Section
      title="Dashboards"
      rationale="Control rooms, not card galleries. A facet rail for scope, one dense stat strip rather than floating tiles, then panels divided by hairlines so the grid reads as a single instrument. Reading order is fixed: how are we doing, what changed, what needs me, then the detail."
    >
      <div className="flex flex-col gap-14">
        <div className="flex flex-col gap-5">
          <Label>Operations — every engagement, one screen</Label>
          <OperationsDashboard />
        </div>

        <div className="flex flex-col gap-5">
          <Label>Engagement — one client, led by live state</Label>
          <EngagementDashboard />
        </div>

        <div className="flex flex-col gap-5">
          <Label>KPI variants — the shape follows the question</Label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="How much" value="1,284" delta={18} sub="Runs completed, 7d" />
            <Kpi label="Against what" value="87.2" unit="%" meter={0.872} sub="Target 85%" tone="ok" />
            <Kpi
              label="Trending how"
              value="1.06"
              unit="$"
              delta={-6}
              invertDelta
              trend={[1.31, 1.28, 1.22, 1.24, 1.17, 1.13, 1.09, 1.06]}
              tone="queue"
            />
            <Kpi
              label="How often"
              value="214"
              trend={[42, 51, 47, 62, 58, 74, 81, 96]}
              trendKind="bar"
              sub="Runs today"
            />
          </div>
          <div className="flex flex-wrap items-center gap-6 pt-1">
            <span className="flex items-center gap-2 text-[12.5px] text-dim">
              <Sparkline points={[3, 5, 4, 7, 6, 9, 8, 11]} width={80} height={24} /> line — a rate
            </span>
            <span className="flex items-center gap-2 text-[12.5px] text-dim">
              <BarSpark points={[3, 5, 4, 7, 6, 9, 8, 11]} width={80} height={24} /> bar — a count
            </span>
            <span className="flex items-center gap-2 text-[12.5px] text-dim">
              <Delta value={18} /> <Delta value={-6} invert /> direction is an arrow, not only a colour
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Media ═══════════════ */

function MediaSpec() {
  return (
    <Section
      title="Media"
      rationale="Photography persuades; it does not inform. It belongs on the marketing shell, a case study, an onboarding screen — and never behind a data view, where it costs legibility and buys nothing."
    >
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <Label>Editorial hero — image plus a directional scrim</Label>
          <MediaHero />
          <span className="max-w-[70ch] text-[12.5px] leading-relaxed text-faint">
            The overlay is a horizontal gradient, not a flat tint: it darkens only the half
            the text occupies, so the photograph stays a photograph. Text on media is always
            white at 100% or 75%, never a theme token, because it sits on an image in both
            themes.
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <Label>Cards — 16:10, cropped not letterboxed</Label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MediaCard
              src="/media/meeting.jpg"
              alt="Team reviewing documents in a meeting room"
              tag="Claims"
              title="Aviva moves first-notice-of-loss onto agents"
              meta="Case study · 6 min read"
            />
            <MediaCard
              src="/media/teamwork.jpg"
              alt="Colleagues working together at a desk"
              tag="Advisory"
              title="Composing an RFP response from four harnesses"
              meta="Walkthrough · 9 min read"
            />
            <MediaCard
              src="/media/chairs.jpg"
              alt="Empty meeting room chairs"
              tag="Governance"
              title="What an approval gate should actually ask a partner"
              meta="Field note · 4 min read"
            />
          </div>
          <span className="max-w-[70ch] text-[12.5px] leading-relaxed text-faint">
            One aspect ratio across a set. The image scales 3% on hover — a scale that reads
            as responsive without becoming a zoom effect — and the frame clips it, so
            neighbouring cards never shift.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <Label>Video — muted, looping, inline</Label>
            <MediaVideo />
            <span className="max-w-[60ch] text-[12.5px] leading-relaxed text-faint">
              Product video is an illustration, not entertainment: muted and looping so it
              never hijacks a page, with controls kept so a viewer can stop it, and a poster
              frame so the panel is never empty while it decodes.
            </span>
          </div>

          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <Label>People</Label>
              <div className="flex items-center gap-4">
                <div className="flex items-center -space-x-2">
                  {[
                    { s: "/media/laptop.jpg", n: "Sana Rahman" },
                    { s: "/media/meeting.jpg", n: "Tom Okafor" },
                    { s: "/media/teamwork.jpg", n: "Lea Vogt" },
                  ].map((p) => (
                    <PhotoAvatar key={p.n} src={p.s} name={p.n} />
                  ))}
                </div>
                <span className="text-[12px] text-faint">
                  Real photographs only where a real person is named.
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Label>Document thumbnails</Label>
              <div className="flex flex-col gap-2">
                <DocThumb
                  src="/media/laptops.jpg"
                  title="Policy 88-4417.pdf"
                  meta="Uploaded by R. Alvarez · 2h ago"
                  pages={14}
                />
                <DocThumb
                  src="/media/chairs.jpg"
                  title="Loss adjuster report.docx"
                  meta="Extracted · 14 fields cited"
                  pages={6}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <Row label="Never">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Abstract renders of neural networks, glowing brains, robot hands, or generated
              faces. If a photograph does not show a real room, a real team, or a real
              document, it is decoration and does not ship.
            </span>
          </Row>
          <Row label="Alt text">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Describes the subject for anyone who cannot see it. Decorative thumbnails beside
              a text label take an empty alt so a screen reader does not read the same thing
              twice.
            </span>
          </Row>
          <Row label="Licensing">
            <span className="max-w-[62ch] text-[13px] leading-[1.65] text-dim">
              Every photograph and the video here are Pixabay Content License — free for
              commercial use, no attribution required. Client work replaces them with
              commissioned or client-supplied imagery.
            </span>
          </Row>
        </div>
      </div>
    </Section>
  );
}

/* ═══════════════ Rejected ═══════════════ */

const REJECTED = [
  ["Coloured glow and neon bloom", "Reads as an AI demo, not software. Achromatic grain and a light direction are the permitted substitute."],
  ["Hue-tinted status fills", "A coloured panel behind small text glows on dark and highlights on light. Hue goes in the dot, the word, or a solid fill with contrasting text."],
  ["Indigo-to-violet gradients", "The most recognisable generated-template signature, inherited from a framework default."],
  ["Decorative grid and noise backgrounds", "Texture behind content that carries no information."],
  ["Glassmorphism and heavy backdrop blur", "Costs legibility and dates the interface."],
  ["Tracked-out caps labels above every heading", "An eyebrow on every section flattens hierarchy instead of creating it."],
  ["Three identical feature cards", "The most common generated layout. Sections are sized by importance instead."],
  ["Pulsing dots on static content", "Motion must represent live state. A pulse on a finished run is a lie about the system."],
  ["Display serifs used as accent", "A serif word dropped into a sans heading is decoration standing in for hierarchy."],
  ["Emoji as interface icons", "Skips every decision a real icon set requires — weight, grid, optical size."],
];

function Rejected() {
  return (
    <Section
      title="Rejected"
      rationale="Recorded so they cannot come back. Each of these appeared in an earlier iteration of this system, and each is a documented signature of generated design."
    >
      <div className="grid grid-cols-1 2xl:grid-cols-2 2xl:gap-x-16">
        {REJECTED.map(([pattern, why]) => (
          <div
            key={pattern}
            className="grid grid-cols-[auto_1fr] gap-3.5 border-b border-line py-3.5 last:border-0"
          >
            <span className="pt-1 text-err" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-medium">{pattern}</span>
              <span className="max-w-[62ch] text-[12.5px] leading-[1.6] text-dim">{why}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

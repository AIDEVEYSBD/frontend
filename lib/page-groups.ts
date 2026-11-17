/**
 * Pages that are one place in the navigation and several tabs on screen.
 *
 * Each tab keeps its own address, so every link that already points at a page
 * still lands on it; the navigation shows the group once, and the header
 * every member page draws (components/page-tabs.tsx) carries the group's
 * name and the tabs. A tab with `param` carries the header's subject in that
 * query parameter (an agent's pages: the same agent on every tab).
 */

export interface PageTab {
  id: string;
  label: string;
  href: string;
  /** The query parameter that names the subject on this tab, when the group has one. */
  param?: string;
}

export interface PageGroup {
  title: string;
  tabs: PageTab[];
}

export const PAGE_GROUPS = {
  results: {
    title: "Results",
    tabs: [
      { id: "outcomes", label: "Summary", href: "/outcomes" },
      { id: "findings", label: "Findings", href: "/findings" },
      { id: "deliverables", label: "Deliverables", href: "/deliverables" },
    ],
  },
  agents: {
    title: "Agents",
    tabs: [
      { id: "agents", label: "Agents", href: "/agents" },
      { id: "applications", label: "Applications", href: "/applications" },
    ],
  },
  /** One agent's pages. The header takes the agent's name as its title and the agent's id as its subject. */
  agent: {
    title: "Agent",
    tabs: [
      { id: "configuration", label: "Configuration", href: "/agent", param: "id" },
      { id: "versions", label: "Versions", href: "/lifecycle", param: "agent" },
      { id: "bom", label: "Bill of materials", href: "/bom", param: "agent" },
    ],
  },
  quality: {
    title: "Quality",
    tabs: [
      { id: "evals", label: "Evaluations", href: "/evals" },
      { id: "drift", label: "Drift", href: "/drift" },
      { id: "acceptance", label: "Acceptance", href: "/acceptance" },
    ],
  },
  data: {
    title: "Data",
    tabs: [
      { id: "knowledge", label: "Knowledge", href: "/knowledge" },
      { id: "datasets", label: "Datasets", href: "/datasets" },
    ],
  },
  resilience: {
    title: "Resilience",
    tabs: [
      { id: "dependencies", label: "Dependencies", href: "/dependencies" },
      { id: "breakers", label: "Breakers", href: "/breakers" },
    ],
  },
  controls: {
    title: "Controls",
    tabs: [
      { id: "catalogue", label: "Catalogue", href: "/guardrails" },
      { id: "inforce", label: "In force", href: "/observability/controls" },
      { id: "policy", label: "Policy", href: "/policy" },
    ],
  },
  assurance: {
    title: "Assurance",
    tabs: [
      { id: "evidence", label: "Evidence", href: "/evidence" },
      { id: "attestations", label: "Attestations", href: "/attestations" },
      { id: "ledger", label: "Ledger", href: "/ledger" },
      { id: "frameworks", label: "Frameworks", href: "/frameworks" },
    ],
  },
} satisfies Record<string, PageGroup>;

export type PageGroupId = keyof typeof PAGE_GROUPS;

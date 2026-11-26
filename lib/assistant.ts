/**
 * Each page of the console, as the assistant drawer names it.
 *
 * The drawer (components/assistant.tsx) shows a page's title and offers its
 * suggested questions, and sends the service the page's path and title so the
 * assistant knows where the person stands. `shows` describes the page for
 * people reading this file: it is not sent to the service, whose assistant
 * answers from the service's own records, which it reads itself
 * (agentfactory/assistant in the backend). This module holds data only.
 */

export interface PageInfo {
  title: string;
  shows: string;
  suggested: string[];
}

export const PAGES: Record<string, PageInfo> = {
  "/control": {
    title: "Control",
    shows:
      "The operational view of deployed workflows, active runs, pending approvals, model spend, latency and control events. Each measure links to supporting run and trace records, and authorized operators can stop an active run.",
    suggested: ["What requires attention?", "What does a control denial mean?", "How is spend calculated?"],
  },
  "/finops": {
    title: "Costs",
    shows:
      "What model calls cost, from the cost recorded with each call, by model, person, team, agent, application and step, over a selectable window; a call with no price set is counted as unpriced, never as free. Cost planning prices each step's recorded tokens on every other offered, priced model (a price comparison, not a measurement; whether a smaller model could do the step is not built). It also checks each run's recorded calls against the cost the run records, holds the budgets per rolling period, and shows where each step's calls are routed and by which rule.",
    suggested: ["What would this step cost on another offered model?", "Why is a cost shown as unpriced?", "How does routing precedence work?"],
  },
  "/agents": {
    title: "Agents",
    shows:
      "The one list of the agents saved on this deployment: what each does, its kind and owner, whether production runs it (deployed, not deployed, paused, blocked or retired), its version and last run. Opening a row shows the steps inside the agent with their purpose, permitted tools, execution pattern, derived autonomy and recent activity. Each agent opens to its Configuration, Versions and Bill of materials tabs.",
    suggested: ["How does an agent get deployed?", "How is a step's autonomy derived?", "What is the difference between deleting and retiring an agent?"],
  },
  "/lifecycle": {
    title: "Lifecycle",
    shows:
      "Each agent from design to retirement: designed, reviewed, approved, canary, deployed, retired, every stage lit only by its own record, with where the version stands now. It holds the policy reviews (signed by someone who did not author the version), the promotion gate's deploys with an administrator's override, deployments per environment, rollback with the runs it flags, canary and shadow beside production (a share of queued starts on the candidate, or a mirror of production runs in shadow mode, where nothing above read executes, with the disagreement rate between the pairs), the lineage of an agent cut from a template with the drift since, each agent's autonomy tier with the controls it lacks, and retirement.",
    suggested: ["What does the promotion gate need for this version?", "How does a shadow run differ from a canary?", "Why is this stage dark?"],
  },
  "/templates": {
    title: "Templates",
    shows:
      "Templates of saved versions: made from an agent's version, pending until a certifier who holds the certifier role and did not author it signs it, then cut into new agents with their params filled. Each agent cut from one keeps its lineage: the template, the digest it was cut from and the drift since.",
    suggested: ["Who may certify a template?", "What happens to a param with no default?", "How is drift from a template measured?"],
  },
  "/deliverables": {
    title: "Deliverables",
    shows:
      "What runs write, as records: each document (report, contract, register export) with its state (draft, reviewed at the report gate, published through the sink the gate held, or withdrawn), its history and its file, served only from the outbox with the digest it was written with; and the registers a records backend wrote to, each item with its state and the runs that wrote it.",
    suggested: ["Why is this deliverable not downloadable?", "How does the report gate review a deliverable?", "What does a withdrawn deliverable mean?"],
  },
  "/policy": {
    title: "Policy",
    shows:
      "Policy as reviewed change. The rules that decide what runs may do (an attached agent's grants and gate risk, the guardian's limits, the estate breakers, rate limits, the screener, retention, redaction, the controls each autonomy tier requires, an attestation period) are proposed with a diff in their own vocabulary, approved by someone other than the proposer, and applied at their effective time. An applied change can be rolled back at once as a recorded emergency. A simulation rules every recorded tool call in a window again under a proposal with the runtime's own enforcer; nothing executes. A spec's own policy changes through its versions, reviews and the promotion gate.",
    suggested: ["Why can't I approve my own change?", "What does an emergency rollback skip?", "What would this proposal have refused last week?"],
  },
  "/evidence": {
    title: "Evidence",
    shows:
      "An assessor's evidence pack for a control or a framework over a period: the control's firings, the signed decisions on its gates, the policy versions and changes in force, the identities that acted, and the chain verification of every run cited. It reads as JSON and downloads as a zip with a manifest and a SHA-256 per file.",
    suggested: ["What is in an evidence pack?", "What does a partly verifiable chain mean?", "How do I verify a pack offline?"],
  },
  "/attestations": {
    title: "Attestations",
    shows:
      "Owner attestations: each deployed agent's owner says, on a schedule, that it still does what was approved. The page shows every deployed agent's standing with the overdue list, and each attestation with what changed in the spec since the last one. An overdue attestation is raised as attention.",
    suggested: ["Who can attest an agent?", "When does an attestation fall due?", "What does the diff compare?"],
  },
  "/frameworks": {
    title: "Frameworks",
    shows:
      "Regulatory views: the estate through one framework or regulation, each agent mapped to its obligations with the evidence that meets each (evidenced, configured, not evidenced or not applicable). Frameworks with no clause mapped to a control, DPDP, SEBI and RBI today, say so plainly.",
    suggested: ["Why does DPDP show no obligations?", "What does evidenced mean here?", "How is an obligation read for an agent?"],
  },
  "/ledger": {
    title: "Ledger",
    shows:
      "The hash chain across the estate: every run's journal is chained, and its last hash is anchored here in order, each run's first entry naming the anchor before it. Walking the ledger verifies every run, and names where a chain breaks, a gap in the ledger, or a genesis no earlier row holds. Retention rules and the tombstones a deletion leaves are here too.",
    suggested: ["What does a broken chain mean?", "Why is a run tombstoned?", "What is an unanchored run?"],
  },
  "/bom": {
    title: "AI-BOM",
    shows:
      "An agent's AI bill of materials: its models with deployment and route, its tools with their data classes and sinks' limits, the servers behind them with their names, versions and pinned tool-list digests, its peers with their card digests, the template it was cut from and its digests. It downloads as CycloneDX.",
    suggested: ["What does a data class do?", "Which servers does this agent depend on?", "How do I export this for a vendor review?"],
  },
  "/runs": {
    title: "Runs",
    shows:
      "The workspace for launching workflows and reviewing execution. The journal records model and tool calls, control decisions, untrusted-content marks, human approvals, interventions and outputs as they occur.",
    suggested: ["What happens when an action is denied?", "How do I respond to an approval request?", "What does an untrusted-content mark mean?"],
  },
  "/dependencies": {
    title: "Dependencies",
    shows:
      "The dependency map: every agent and the tools it calls, the servers and connectors that serve them, the sub-agents it invokes, the peers it hands work to, the models it uses and the applications built on them. Each edge is declared by the specs, seen in the journals of the window, or both, with its count, cost, failures and refusals. Picking a node shows its blast radius: the agents that fail if it does (directly or through another agent, with the path), the runs in flight and the applications.",
    suggested: ["What fails if this tool server goes down?", "Which edges are declared but never used?", "Which calls happen that no spec declares?"],
  },
  "/drift": {
    title: "Drift",
    shows:
      "Per agent, the last day of finished runs against the thirty days before it, on disposition mix and tool mix (Jensen–Shannon distance, past 0.2), confidence and cost per run (Welch's z, past ±2) and refusal rate (two-proportion z). An agent with too few runs in either window is not compared. A shift past a threshold is raised in the attention queue.",
    suggested: ["Which agents drifted, and on what?", "What does a Jensen–Shannon distance of 1 mean?", "Why does an agent say not enough runs?"],
  },
  "/guardian": {
    title: "Guardian",
    shows:
      "The guardian: a watcher, not a model, that checks every run in flight about every ten seconds against three per-run limits a person sets through a reviewed policy change: tool calls per run, cost per run in US dollars and refused calls per run, for every agent or the ones listed. Past a limit it does what that limit says: hold the run (its next call at or above write waits for a person), stop it, or raise it for a person. A run whose cost is unknown because a model it called has no price set is raised, never compared as if it cost nothing. The page lists every action it took or raised.",
    suggested: ["What does the guardian do when a run passes a limit?", "Why was a run raised and not stopped?", "How is a run's cost compared when a model has no price set?"],
  },
  "/breakers": {
    title: "Breakers",
    shows:
      "The estate's circuit breakers, per sink tool and per peer: past the calls threshold within the window, or after the failures threshold in a row, counted across every run, a breaker opens for its cooldown; every worker is served it and every run is refused the call, then one call is let through. The page shows what is open now and when each closes on its own, the thresholds, and the recent openings with the run that tripped each; a person with configure may close one by hand.",
    suggested: ["Why did this breaker open?", "What happens to runs while a breaker is open?", "When does a breaker close on its own?"],
  },
  "/evals": {
    title: "Evals",
    shows: "Evaluation suites that execute labelled cases through the production runtime, score outcomes deterministically and compare candidate models using quality, cost and execution time.",
    suggested: ["How does Compare models choose a recommendation?", "What does the threshold on an eval set decide?"],
  },
  "/knowledge": {
    title: "Knowledge base",
    shows:
      "The pipeline and curated register for content available to workflows. It shows source licensing, ingestion and indexing stages, content awaiting human admission, the bucket connectors that ingest a body of documents under a rule a second person admits (with each connector's health and the objects that failed and why), and an Ask panel: Search runs the retrieval stages (hybrid search over meaning and words, re-ranking by the chat model the deployment offers when it offers one, guardrails in the query) and shows the passages; Answer runs the agentic loop (judge the evidence, rewrite and retry the query up to three times, answer from the passages only with every claim cited, check each cited sentence against its passage) and shows the answer with hoverable, clickable citations that open the document at the passage, plus the attempts and the grounding verdicts.",
    suggested: ["Why is human approval required before indexing?", "Which connector objects failed, and why?", "Which sources may be cited but not stored?"],
  },
  "/guardrails": {
    title: "Controls",
    shows:
      "The register of controls applied across workflows. Each control identifies its implementation, resulting evidence, related standards, observed events and whether responsibility sits with the platform, the deploying organization or both.",
    suggested: ["Which controls address prompt injection?", "Which controls remain the deploying organization’s responsibility?", "How does the register reference OWASP guidance?"],
  },
  "/configuration": {
    title: "Configuration",
    shows:
      "Everything this deployment is set up with, in folding panels on five tabs: Models (models detected on Google Vertex AI when the deployment can reach it, Providers, Models), Tools (Tool servers, Tool registry, Saros as an MCP server), Connections (Connected sources, Peers, Third-party agents, Egress allowlist), Access (Credentials, Ingress, Where a person signs) and Deployment (Deployment, Appearance). The open tab is in the address as ?tab=, and each panel is addressed by its id after # in the address, which opens its tab and the panel. Each panel says what it is for in a sentence or two; the longer account of how it works is behind a small disclosure in the panel, and the Third-party agents panel keeps its install lines and snippets behind Show the code. Read from the saved workflows, the run records and the registries: the deployment and its egress allowlist, third-party agents, the platform's own MCP server, the registered tool servers, the connections and tools the workflows hold with their declared risk, scope and observed use, where a person signs, and ingress keys with the queue. Managed here: the providers model calls can go to, the models offered with their tier, prices, the run default and each tier's default, the vault's credentials (referenced from specs by name, values shown masked), and the console's appearance. The Peers panel is the A2A peer registry: other parties' agents this deployment hands tasks to and hears tasks from. Registering fetches the peer's agent card signed under a secret the two sides share and pins it by digest; the peer stays pending, neither spoken to nor heard, until a person approves the card (a second person when two-person approval is on). A rescan that finds another card marks the peer changed and refuses it both ways until someone approves again, showing the approved digest against the new one and the skills that moved. A card that could not be fetched is kept with the fetch's error. The secret is shown by its vault name only.",
    suggested: ["Which connectors can act outside the platform?", "Which model is the default and why?", "Why is this peer refused?"],
  },
  "/explore": {
    title: "Explore",
    shows: "Everything the platform recorded, in three views: tool calls, agent activity and security events. A timeline narrows the window, a filter rail narrows by agent, tool, status, kind of event and person, and each row opens the run entry it came from.",
    suggested: ["Which tools fail most often?", "What did this agent do in the last day?", "Which calls were refused, and by what?"],
  },
  "/dashboards": {
    title: "Dashboards",
    shows: "Three fixed boards drawn from the same records as the pages they link to: security posture (approvals waiting, refusals, kills, lockdown, controls that fired), cost (spend over time, by agent and by model, budget use) and workload results (findings by severity and workload).",
    suggested: ["What needs a security lead's attention?", "Where is spend concentrated?", "How many findings are still open?"],
  },
  "/sessions": {
    title: "Sessions",
    shows: "Every live connection and who is behind it: people signed in to the console, agents holding a key or a workload sign-in, and connections held open to tool servers. An administrator can end a session or a client's registration.",
    suggested: ["Who is connected right now?", "What stops working when a session is ended?", "When does a session have to be renewed?"],
  },
  "/authorization": {
    title: "Authorization servers",
    shows: "The outside issuers this deployment trusts: how people sign in to the console, the services trusted to issue a per-person token for a tool, and the issuers whose tokens an agent or worker may exchange for a short session without a stored key.",
    suggested: ["How do people sign in here?", "Why call a tool as the person and not with a shared key?", "What happens when trust in an issuer is withdrawn?"],
  },
  "/iam": {
    title: "Identity and access",
    shows: "People, roles and non-human identities authorized to use or act within this deployment, including ownership, permissions, credential age and observed activity.",
    suggested: ["Which identities require review?", "How are permissions derived?", "Which credentials should be rotated?"],
  },
};

export function pageFor(path: string): { path: string; info: PageInfo } {
  const key = Object.keys(PAGES).find((k) => path === k || path.startsWith(`${k}/`)) ?? "";
  return key
    ? { path: key, info: PAGES[key] }
    : { path, info: { title: "Saros", shows: "The Saros console.", suggested: ["What is Saros?", "How does it keep agents safe?"] } };
}

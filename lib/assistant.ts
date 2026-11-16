/**
 * What the assistant knows about each page of the console.
 *
 * The assistant is available on every page, and the first thing it needs is
 * where the person is standing. Each route carries a short account of what
 * the page shows and the questions a visitor tends to have there; pages add
 * live facts at runtime through `setPageFacts` in components/assistant.tsx.
 * This module is shared by the client (suggestions, titles) and the server
 * (system prompt), so it holds data only.
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
    title: "FinOps",
    shows:
      "Model spend by provider, workflow and step, computed from every journalled model call at the configured price, over a selectable window with per-card overrides. It shows hand-off candidates (steps whose call profile and eval evidence suit a smaller or local model), a calculator that replays the workload on any model, per-step model routing that outranks the spec, the providers the deployment can reach (Foundry, Vertex, Bedrock, vLLM, Ollama, LM Studio) and billing against budget.",
    suggested: ["Which steps could move to a local model?", "What would this month cost on a smaller model?", "How does routing precedence work?"],
  },
  "/workflows": {
    title: "Workflows",
    shows: "The registry of saved workflow specifications, including their versions, digests, model requirements and permitted tools.",
    suggested: ["What is a spec digest and why does it matter?", "How does a workflow get deployed?"],
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
  "/roster": {
    title: "Roster",
    shows: "The agents within each deployed workflow, including their purpose, execution pattern, permitted tools, derived autonomy and recent activity.",
    suggested: ["How do agents authenticate to each other?"],
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
      "The guardian: a supervisory model that reads each covered run's trajectory against the run's goal and a rubric. Its limits are a person's, changed through a reviewed policy change: which agents it watches, whether it may hold a run at its next gate or block it, an hourly cap, a confidence floor, its model and cadence. Outside its limits it only raises attention. The page lists every verdict it acted on or raised, with the reason and the model.",
    suggested: ["What may the guardian do on its own?", "Why was a verdict only raised for a person?", "How is the hourly cap counted?"],
  },
  "/peers": {
    title: "Peers",
    shows:
      "The A2A peer registry: other parties' agents this factory hands tasks to and hears tasks from. Registering fetches the peer's agent card signed under a secret the two sides share and pins it by digest; the peer stays pending, neither spoken to nor heard, until a person approves the card (a second person when two-person approval is on). A rescan that finds another card marks the peer changed and refuses it both ways until someone approves again, showing the approved digest against the new one and the skills that moved. A card that could not be fetched is kept with the fetch's error. The secret is shown by its vault name only.",
    suggested: ["Why is this peer refused?", "What changed on this peer's card?", "How do two factories register each other?"],
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
    suggested: ["How does Compare models choose a recommendation?", "How were the Aegis benchmark results produced?"],
  },
  "/knowledge": {
    title: "Knowledge base",
    shows:
      "The pipeline and curated register for content available to workflows. It shows source licensing, ingestion and indexing stages, content awaiting human admission, and an Ask panel: Search runs the retrieval stages (hybrid search over meaning and words, a cross-encoder rerank, guardrails in the query) and shows the passages; Answer runs the agentic loop (judge the evidence, rewrite and retry the query up to three times, answer from the passages only with every claim cited, check each cited sentence against its passage) and shows the answer with hoverable, clickable citations that open the document at the passage, plus the attempts and the grounding verdicts.",
    suggested: ["Why is human approval required before indexing?", "How does the answer loop decide to retry?", "Which sources may be cited but not stored?"],
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
      "The current configuration of systems, tools, models, credentials and interfaces available to deployed workflows. It presents declared risk, scope and ownership alongside observed health and use, without displaying protected credential values.",
    suggested: ["Which connectors can act outside the platform?", "How are credentials resolved at runtime?", "What does an untrusted-content designation mean?"],
  },
  "/settings": {
    title: "Settings",
    shows: "Deployment settings for the model gateway, approved models, routing defaults, prices, protected credentials and operator preferences.",
    suggested: ["Which model is the default and why?"],
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
    : { path, info: { title: "Agent Factory", shows: "The Agent Factory console.", suggested: ["What is Agent Factory?", "How does it keep agents safe?"] } };
}

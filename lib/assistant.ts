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
  "/builder": {
    title: "Builder",
    shows:
      "The visual workspace for designing governed workflows. Each step uses one of three execution patterns—sequence, delegate or await—and declares its model requirements, permitted tools, data contracts and approval points.",
    suggested: ["How do I add a human approval step?", "What does a delegate node do?", "Which connectors can a step use?"],
  },
  "/workflows": {
    title: "Workflows",
    shows: "The registry of saved workflow specifications, including their versions, digests, model requirements and permitted tools.",
    suggested: ["What is a spec digest and why does it matter?", "How does a workflow get deployed?"],
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

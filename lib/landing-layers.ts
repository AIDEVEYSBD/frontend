/**
 * The architecture layers the landing page draws, as data, so the assistant
 * and the page describe the same thing.
 */

export interface Layer {
  id: string;
  question: string;
  headline: string;
  support: string;
  /** Real, shipped features, the chips drawn on the layer plane. */
  chips: string[];
  token: string;
}

export const LAYERS: Layer[] = [
  {
    id: "experience",
    question: "How are workflows designed?",
    headline: "Turn established procedures into governed workflows.",
    support:
      "Describe a process in plain language or configure it visually. The builder creates a structured specification with defined inputs, outputs, permissions and review points, then applies the same validation used at deployment.",
    chips: ["Canvas", "Agent builder", "Deploy theater"],
    token: "--t-c1",
  },
  {
    id: "lifecycle",
    question: "How are workflows validated?",
    headline: "Build confidence before deployment.",
    support:
      "Design, evaluation, deployment and monitoring each produce their own record. The registry maintains a current inventory of workflows, models and tools so teams can assess readiness using evidence from the platform.",
    chips: ["Registry", "Benchmarks", "Deploy stamps"],
    token: "--t-c2",
  },
  {
    id: "workplane",
    question: "How is activity recorded?",
    headline: "Maintain a complete record of execution.",
    support:
      "Execution journals capture what ran, which sources and tools were used, what changed and which outputs were produced. Provenance links each step to the information and decisions on which it relied.",
    chips: ["Journal", "Provenance", "Artifacts"],
    token: "--t-c3",
  },
  {
    id: "control",
    question: "Where do people remain accountable?",
    headline: "Keep people responsible for consequential decisions.",
    support:
      "Defined steps can pause for an authorized person to review the evidence and decide how the workflow should proceed. Approval, refusal and operational intervention are retained with the execution record.",
    chips: ["Gates", "Kill switch", "FinOps", "Evals"],
    token: "--t-warn",
  },
  {
    id: "knowledge",
    question: "How is access constrained?",
    headline: "Limit access to what each task requires.",
    support:
      "Each workflow step declares the sources, records and tools it may use, with scope limits applied within those permissions. External content remains identified as untrusted as it moves toward consequential actions.",
    chips: ["Retrieval", "Records", "Engines", "Taint rules"],
    token: "--t-c5",
  },
  {
    id: "partners",
    question: "How do external agents participate?",
    headline: "Apply consistent controls across agent boundaries.",
    support:
      "Partner agents connect through standard interfaces and participate within the same identity, permission and provenance model. Their responses are treated as external content and remain identifiable throughout the workflow.",
    chips: ["A2A discover", "Hand-off", "Tainted replies"],
    token: "--t-c6",
  },
  {
    id: "models",
    question: "How are models selected?",
    headline: "Select models according to the task.",
    support:
      "Workflow steps state their model requirements and the deployment maps those requirements to approved models. Routing can reflect data sensitivity, policy, performance and cost.",
    chips: ["Per-node routing", "Local models", "Frontier models"],
    token: "--t-c7",
  },
  {
    id: "foundations",
    question: "What applies across the platform?",
    headline: "Embed governance throughout the operating model.",
    support:
      "Identity, policy and audit apply across every layer. Credentials are resolved at the point of use, inputs are screened for manipulation attempts and the runtime is designed to operate within the organization’s environment.",
    chips: ["Vault", "Injection filters", "Your tenancy"],
    token: "--t-c9",
  },
];

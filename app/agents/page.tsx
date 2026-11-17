import { AgentsList } from "@/components/agents-list";

export const metadata = {
  title: "Agents — Agent Factory",
  description: "Every agent saved on this deployment: what it does, its kind and owner, whether production runs it, its version and last run, and the steps inside it.",
};

export default function AgentsPage() {
  return <AgentsList />;
}

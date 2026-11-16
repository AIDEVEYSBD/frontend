import { AgentConfigView } from "@/components/agent-config";

export const metadata = {
  title: "Agent configuration — Agent Factory",
  description: "One agent's limits, bounds and gates, with the tools each step was granted; a change is saved as a new version and deployed from Lifecycle.",
};

export default function AgentPage() {
  return <AgentConfigView />;
}

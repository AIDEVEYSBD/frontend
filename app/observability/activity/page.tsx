import { AgentActivityView } from "@/components/observability-activity";

export const metadata = {
  title: "Agent activity — Agent Factory",
  description: "What each agent did in a time window: runs, steps, model calls, tool calls, failed runs and when it was last active.",
};

export default function AgentActivityPage() {
  return <AgentActivityView />;
}

import { ToolCallsView } from "@/components/observability-tools";

export const metadata = {
  title: "Tool calls — Agent Factory",
  description: "Every tool call across runs in a time window: when, run, agent, step, tool, outcome and duration.",
};

export default function ToolCallsPage() {
  return <ToolCallsView />;
}

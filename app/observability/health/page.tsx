import { PlatformHealthView } from "@/components/observability-health";

export const metadata = {
  title: "Platform health — Agent Factory",
  description: "Failures, the queue, model and tool calls, breakers, held agents, alerts and telemetry, counted from the platform's own records.",
};

export default function PlatformHealthPage() {
  return <PlatformHealthView />;
}

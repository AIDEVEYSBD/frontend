import { ControlsInForceView } from "@/components/observability-controls";

export const metadata = {
  title: "Controls in force — Agent Factory",
  description: "What governs one agent: gates, granted tools, limits, estate rules, autonomy tier and the controls they map to.",
};

export default function ControlsInForcePage() {
  return <ControlsInForceView />;
}

import { Workflows } from "@/components/workflows";

export const metadata = {
  title: "Workflows — Agent Factory",
  description: "Every saved agent: open it in the builder, run it, chain it.",
};

export default function WorkflowsPage() {
  return <Workflows />;
}

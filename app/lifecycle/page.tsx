import { LifecycleView } from "@/components/lifecycle";

export const metadata = {
  title: "Agent versions — Saros",
  description: "Each agent from design to retirement: reviews, the promotion gate, deployments per environment, rollback and retirement, each stage lit only by its own record.",
};

export default function LifecyclePage() {
  return <LifecycleView />;
}

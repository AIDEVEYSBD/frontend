import { Drift } from "@/components/drift";

export const metadata = {
  title: "Drift — Saros",
  description: "Per agent, the last day of runs against the thirty days before: disposition mix, confidence, cost per run, tool mix and refusal rate.",
};

export default function DriftPage() {
  return <Drift />;
}

import { OutcomesView } from "@/components/outcomes";

export const metadata = {
  title: "Results — Saros",
  description: "Each security workload over a time window: its runs, its last run, and its findings by severity and status.",
};

export default function OutcomesPage() {
  return <OutcomesView />;
}

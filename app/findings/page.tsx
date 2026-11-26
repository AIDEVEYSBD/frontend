import { FindingsView } from "@/components/findings";

export const metadata = {
  title: "Findings — Saros",
  description: "What the security workloads reported: each finding with its severity, status, evidence and history.",
};

export default function FindingsPage() {
  return <FindingsView />;
}

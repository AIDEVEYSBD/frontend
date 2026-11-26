import { DeliverablesView } from "@/components/deliverables";

export const metadata = {
  title: "Deliverables — Saros",
  description: "What runs write, as records: each document with its state, history and file, and the registers a records backend wrote to.",
};

export default function DeliverablesPage() {
  return <DeliverablesView />;
}

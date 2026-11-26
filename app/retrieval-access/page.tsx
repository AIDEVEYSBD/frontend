import { RetrievalAccessView } from "@/components/retrieval-access";

export const metadata = {
  title: "Retrieval access — Saros",
  description: "Which agent may read, write or delete in which knowledge store, and the switch that stops retrieval from a store for every agent.",
};

export default function RetrievalAccessPage() {
  return <RetrievalAccessView />;
}

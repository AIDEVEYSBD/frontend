import { DatasetsView } from "@/components/datasets";

export const metadata = {
  title: "Datasets — Saros",
  description: "What a security workload is run on: code snapshots, firewall exports, telemetry extracts and documents, offline or live.",
};

export default function DatasetsPage() {
  return <DatasetsView />;
}

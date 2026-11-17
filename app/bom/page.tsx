import { BomPageView } from "@/components/bom";

export const metadata = {
  title: "Agent bill of materials — Agent Factory",
  description: "An agent's AI bill of materials: models and routes, tools and their data classes, servers and peers with their digests, as JSON or CycloneDX.",
};

export default function BomPage() {
  return <BomPageView />;
}

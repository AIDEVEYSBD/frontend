import { TemplatesView } from "@/components/templates";

export const metadata = {
  title: "Templates — Agent Factory",
  description: "Certified templates of saved versions: made from an agent's version, certified by someone who did not author it, and cut into new agents that keep their lineage.",
};

export default function TemplatesPage() {
  return <TemplatesView />;
}

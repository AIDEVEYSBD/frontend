import { ExploreView } from "@/components/explore";

export const metadata = {
  title: "Explore — Saros",
  description: "Filter and read everything the platform recorded: tool calls, what each agent did, and what the controls and people stopped.",
};

export default function ExplorePage() {
  return <ExploreView />;
}

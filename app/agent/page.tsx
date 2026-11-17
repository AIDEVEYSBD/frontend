import { redirect } from "next/navigation";
import { AgentConfigView } from "@/components/agent-config";

export const metadata = {
  title: "Agent configuration — Agent Factory",
  description: "One agent's limits, bounds and gates, with the tools each step was granted; a change is saved as a new version and deployed from its Versions tab.",
};

/** One agent's Configuration tab. With no agent named there is nothing to configure: the address goes to the list. */
export default async function AgentPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { id } = await searchParams;
  if (!(Array.isArray(id) ? id[0] : id)) redirect("/agents");
  return <AgentConfigView />;
}

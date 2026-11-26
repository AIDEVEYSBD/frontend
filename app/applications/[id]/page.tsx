import { ApplicationDashboard } from "@/components/application-dashboard";

export const metadata = {
  title: "Application — Saros",
  description: "Volume, cost, latency, refusals, screened hits and the model mix of one governed application, with every conversation replayable.",
};

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationDashboard id={id} />;
}

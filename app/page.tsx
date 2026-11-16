import { Closing, Controls, Hero, LandingFooter, LandingHeader, Passage, Workloads } from "@/components/landing";

export const metadata = {
  title: "Agent Factory — ABB AI SecOps Platform",
  description:
    "The console for four security workloads carried out by agents: static code analysis, penetration testing, firewall rule review and threat hunting, each behind the same approvals, limits and journal.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface">
      <LandingHeader />
      <main>
        <Hero />
        <Workloads />
        <Controls />
        <Passage />
        <Closing />
      </main>
      <LandingFooter />
    </div>
  );
}

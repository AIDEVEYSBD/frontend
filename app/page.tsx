import { Closing, Controls, Hero, LandingFooter, LandingHeader, Passage, Workloads } from "@/components/landing";

import { LandingMotion } from "@/components/landing-motion";

export const metadata = {
  title: "Saros — ABB AI SecOps Platform",
  description:
    "AI-powered security. Human-led control. Coordinate code analysis, penetration testing, firewall rule review and threat hunting with defined approvals and traceable evidence.",
};

export default function LandingPage() {
  return (
    <LandingMotion>
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Workloads />
        <Controls />
        <Passage />
        <Closing />
      </main>
      <LandingFooter />
    </LandingMotion>
  );
}

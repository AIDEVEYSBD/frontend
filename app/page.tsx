import {
  Builders,
  Deployment,
  Harnesses,
  Hero,
  Integrations,
  LandingFooter,
  LandingHeader,
  Security,
} from "@/components/landing";
import { ArchitectureStory } from "@/components/landing-architecture";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <LandingHeader />
      <main>
        <Hero />
        <ArchitectureStory />
        <Builders />
        <Harnesses />
        <Integrations />
        <Deployment />
        <Security />
      </main>
      <LandingFooter />
    </div>
  );
}

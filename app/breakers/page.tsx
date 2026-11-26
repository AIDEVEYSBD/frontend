import { Breakers } from "@/components/breakers";

export const metadata = {
  title: "Breakers — Saros",
  description: "The estate's circuit breakers per sink tool and per peer: what is open now, the thresholds, the recent openings, and closing one by hand.",
};

export default function BreakersPage() {
  return <Breakers />;
}

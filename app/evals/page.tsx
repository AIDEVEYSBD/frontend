import { Suspense } from "react";
import { Evals } from "@/components/evals";

export const metadata = {
  title: "Evaluations — Agent Factory",
  description: "Evaluate workflow quality, cost and execution time using representative, fully recorded runs.",
};

export default function EvalsPage() {
  return (
    <Suspense>
      <Evals />
    </Suspense>
  );
}

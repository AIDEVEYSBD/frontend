import { Suspense } from "react";
import { Evals } from "@/components/evals";

export const metadata = {
  title: "Evals — Agent Factory",
  description: "Upload benchmarks beside your agents; every score is a real, journalled run.",
};

export default function EvalsPage() {
  return (
    <Suspense>
      <Evals />
    </Suspense>
  );
}

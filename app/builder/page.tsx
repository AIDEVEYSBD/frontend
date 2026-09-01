import { Suspense } from "react";
import { Builder } from "@/components/builder";

export const metadata = {
  title: "Builder — Agent Factory",
  description: "Assemble an agent from the three harnesses and deploy it.",
};

export default function BuilderPage() {
  return (
    <Suspense>
      <Builder />
    </Suspense>
  );
}

import { Suspense } from "react";
import { Builder } from "@/components/builder";

export const metadata = {
  title: "Builder — Agent Factory",
  description: "Design and validate governed AI-enabled workflows using controlled execution patterns.",
};

export default function BuilderPage() {
  return (
    <Suspense>
      <Builder />
    </Suspense>
  );
}

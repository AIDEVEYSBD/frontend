import { Guardrails } from "@/components/guardrails";

export const metadata = {
  title: "Controls — Agent Factory",
  description:
    "Review the controls applied across workflows, their implementation evidence and their relationship to recognized standards.",
};

export default function GuardrailsPage() {
  return <Guardrails />;
}

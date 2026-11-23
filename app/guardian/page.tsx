import { Guardian } from "@/components/guardian";

export const metadata = {
  title: "Guardian — Agent Factory",
  description: "The guardian's per-run limits, set by a person through a reviewed policy change, and every hold, stop or raise it made.",
};

export default function GuardianPage() {
  return <Guardian />;
}

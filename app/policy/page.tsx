import { PolicyView } from "@/components/policy";

export const metadata = {
  title: "Policy — Agent Factory",
  description: "Policy as reviewed change: proposed with a diff, approved by someone else, applied at its effective time, rolled back in an emergency, and simulated over what already ran.",
};

export default function PolicyPage() {
  return <PolicyView />;
}

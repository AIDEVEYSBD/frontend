import { AuthorizationView } from "@/components/authorization";

export const metadata = {
  title: "Authorization servers — Saros",
  description: "The outside issuers this deployment trusts: who signs people in, who gives a per-person token for a tool, and whose tokens a workload may exchange.",
};

export default function AuthorizationPage() {
  return <AuthorizationView />;
}

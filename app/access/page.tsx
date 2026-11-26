import { AccessLogView } from "@/components/access-log";

export const metadata = {
  title: "Access log — Saros",
  description: "Who opened which run, evidence pack, deliverable or document, and when.",
};

export default function AccessLogPage() {
  return <AccessLogView />;
}

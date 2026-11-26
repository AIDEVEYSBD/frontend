import { SessionsView } from "@/components/sessions";

export const metadata = {
  title: "Sessions — Saros",
  description: "Every live connection to this deployment and who is behind it: people, agents and the connections held open to tool servers.",
};

export default function SessionsPage() {
  return <SessionsView />;
}

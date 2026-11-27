import { AskPage } from "@/components/ask-page";

export const metadata = {
  title: "Assistant — Saros",
  description: "Ask about this deployment on a full page; the records an answer names open as cards in the conversation.",
};

export default function AskRoute() {
  return <AskPage />;
}

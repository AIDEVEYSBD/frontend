import { ChatView } from "@/components/chat";

export const metadata = {
  title: "Chat — Agent Factory",
  description: "Talk to a chatbot registered on this deployment as it is governed, and ask a security workload to do something.",
};

export default function ChatPage() {
  return <ChatView />;
}

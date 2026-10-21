import { Peers } from "@/components/peers";

export const metadata = {
  title: "Peers — Agent Factory",
  description: "The A2A agents this factory hands tasks to and hears tasks from: each card pinned by digest and approved by a person, the shared secret by its vault name.",
};

export default function PeersPage() {
  return <Peers />;
}

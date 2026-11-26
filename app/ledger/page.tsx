import { LedgerView } from "@/components/chain";

export const metadata = {
  title: "Ledger — Saros",
  description: "The estate's run anchors walked in order: each run verified against its hash chain, each break named, and the tombstones retention left.",
};

export default function LedgerPage() {
  return <LedgerView />;
}

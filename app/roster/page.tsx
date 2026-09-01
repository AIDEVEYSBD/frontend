import { Roster } from "@/components/roster";

export const metadata = {
  title: "Roster — Agent Factory",
  description:
    "Every deployed agent by workflow: purpose, derived autonomy, hierarchy, and live run activity.",
};

export default function RosterPage() {
  return <Roster />;
}

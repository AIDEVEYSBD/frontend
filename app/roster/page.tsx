import { Roster } from "@/components/roster";

export const metadata = {
  title: "Roster — Agent Factory",
  description:
    "Review deployed agents by workflow, including their purpose, permissions, control pattern and recent activity.",
};

export default function RosterPage() {
  return <Roster />;
}

import { WorkloadsView } from "@/components/workloads";

export const metadata = {
  title: "Workloads — Agent Factory",
  description: "The four security workloads this console controls: what each takes, where a person decides, what comes out, and the guided set-up of a run.",
};

export default function WorkloadsPage() {
  return <WorkloadsView />;
}

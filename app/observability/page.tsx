import { redirect } from "next/navigation";

/** The group has no page of its own: it opens on tool calls. */
export default function ObservabilityPage() {
  redirect("/observability/tools");
}

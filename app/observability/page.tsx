import { redirect } from "next/navigation";

/** The group has no page of its own: it opens on Explore, at tool calls. */
export default function ObservabilityPage() {
  redirect("/explore?view=tools");
}

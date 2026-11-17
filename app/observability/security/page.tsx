import { redirect } from "next/navigation";

/** A retired address: Security events is now a view of Explore. The old page listed every event the doors hold whatever its age, so the link opens on all time unless it names a window. The rest of the query string is kept. */
export default async function RetiredPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = new URLSearchParams({ view: "security" });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "view") continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  if (!query.has("window")) query.set("window", "all");
  redirect(`/explore?${query.toString()}`);
}

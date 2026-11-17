import { redirect } from "next/navigation";

/** A retired address: Tool calls is now a view of Explore. The rest of the query string is kept. */
export default async function RetiredPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = new URLSearchParams({ view: "tools" });
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "view") continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  redirect(`/explore?${query.toString()}`);
}

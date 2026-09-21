import { Login } from "@/components/login";

export const metadata = { title: "Sign in — Agent Factory" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = typeof q.next === "string" && q.next.startsWith("/") ? q.next : "/control";
  const error = typeof q.error === "string" ? q.error : "";
  return (
    <>
      <link rel="preconnect" href="https://sso.autogrc.cloud" />
      <link rel="dns-prefetch" href="https://sso.autogrc.cloud" />
      <Login next={next} error={error} />
    </>
  );
}

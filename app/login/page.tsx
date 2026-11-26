import { BrandLockup } from "@/components/brand";

export const metadata = { title: "Sign in — Saros" };
export const dynamic = "force-dynamic";

/**
 * The way in. Google Identity-Aware Proxy signs a person in before any
 * request reaches the console, and the platform's service decides at
 * /api/auth/login whether they may enter: it sends them on, or to /no-access
 * with the reason. This page says nothing about sign-in itself, because it
 * cannot know; it is one plain link to that door (a full request, so IAP's
 * header is on it). With BACKEND_ORIGIN set it answers 200 without asking the
 * service, which is what a health probe reads; without it proxy.ts answers 503.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = typeof q.next === "string" && q.next.startsWith("/") && !q.next.startsWith("//") ? q.next : "/overview";
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex w-[min(440px,100%)] flex-col gap-5 rounded-lg border border-line bg-surface p-7 elev-2">
        <BrandLockup />
        <span className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Open the console</span>
        <span>
          <a href={`/api/auth/login?next=${encodeURIComponent(next)}`} className="focusable inline-flex h-9 items-center rounded-md bg-fg px-4 text-[13px] font-medium text-canvas">
            Continue
          </a>
        </span>
      </div>
    </div>
  );
}

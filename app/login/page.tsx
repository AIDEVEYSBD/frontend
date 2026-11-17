import Link from "next/link";
import { Login } from "@/components/login";
import { BrandLockup } from "@/components/brand";

export const metadata = { title: "Sign in — Agent Factory" };
export const dynamic = "force-dynamic";

/**
 * The way in. With an OpenID Connect provider configured this is its sign-in
 * page. Behind Google IAP the person is already signed in when they get here,
 * and with sign-in off there is nothing to sign in to, so in both cases the
 * page is one plain door to the console and names no provider. It always
 * answers 200, which is what a health probe reads.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = typeof q.next === "string" && q.next.startsWith("/") && !q.next.startsWith("//") ? q.next : "/overview";
  const error = typeof q.error === "string" ? q.error : "";
  const oidc = Boolean(process.env.AUTOX_CLIENT_ID && process.env.AUTOX_CLIENT_SECRET && process.env.AUTH_SECRET);
  if (!oidc) {
    const iap = Boolean(process.env.IAP_AUDIENCE && process.env.AUTH_SECRET);
    const href = iap ? `/api/auth/login?next=${encodeURIComponent(next)}` : next;
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="flex w-[min(440px,100%)] flex-col gap-5 rounded-lg border border-line bg-surface p-7 elev-2">
          <BrandLockup />
          <span className="flex flex-col gap-1">
            <span className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Open the console</span>
            <span className="text-[12.5px] leading-[1.55] text-faint">
              {iap ? "You are signed in with your Google account. Continue to the console." : "Sign-in is off on this deployment."}
            </span>
          </span>
          <span>
            {/* A plain link for the sign-in door (a full request, so IAP's header is on it); a client link otherwise. */}
            {iap ? (
              <a href={href} className="focusable inline-flex h-9 items-center rounded-md bg-fg px-4 text-[13px] font-medium text-canvas">Continue</a>
            ) : (
              <Link href={href} className="focusable inline-flex h-9 items-center rounded-md bg-fg px-4 text-[13px] font-medium text-canvas">Continue</Link>
            )}
          </span>
        </div>
      </div>
    );
  }
  return (
    <>
      <link rel="preconnect" href="https://sso.autogrc.cloud" />
      <link rel="dns-prefetch" href="https://sso.autogrc.cloud" />
      <Login next={next} error={error} />
    </>
  );
}

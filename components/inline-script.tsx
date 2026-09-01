/**
 * An inline script that runs during HTML parsing, before first paint —
 * the Next-documented shape (see next/dist/docs … preventing-flash-before-hydration).
 *
 * On the server it renders as executable; on the client as text/plain, so a
 * client render never re-executes it and React never warns about a live
 * script tag in component output. suppressHydrationWarning covers the one
 * attribute that legitimately differs.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

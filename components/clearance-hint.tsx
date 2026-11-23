import Link from "next/link";

/**
 * Where a model is cleared for a class of data, said beside a call the
 * service did not make because no offered model was cleared for what it
 * would send: a knowledge answer declined `not_cleared`, or a re-ranking
 * left out "not re-ranked: no model cleared for <class> data could take this
 * call: <models> … not cleared for it". The service's own sentence names the
 * class and the models looked at; this adds where the clearance is set.
 */

/** The service's wording when no offered model is cleared for a call's data (agentfactory modelconfig.py `NotCleared`). */
export const NOT_CLEARED = /no model cleared for|not cleared for it|so no model is cleared for it/i;

export function ClearanceHint({ className = "" }: { className?: string }) {
  return (
    <span className={`text-[11px] leading-[1.5] text-faint ${className}`}>
      A model is sent only the classes of data it is cleared for. A platform admin clears a model for a class, or names a cleared fallback, under{" "}
      <Link href="/configuration?tab=models#models" className="focusable rounded-sm text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
        Configuration, Models, Clearance and fallbacks
      </Link>
      .
    </span>
  );
}

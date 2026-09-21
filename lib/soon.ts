/**
 * Run `fn` on the next tick and hand back a canceller.
 *
 * For effects whose first act is to load state. The load is scheduled rather
 * than synchronous, so a mount paints once before the fetch begins, and an
 * unmount before the tick fires loads nothing. The interval-and-first-load
 * shape reads as `const cancel = soon(load); const id = setInterval(load, ms)`.
 */
export function soon(fn: () => unknown): () => void {
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

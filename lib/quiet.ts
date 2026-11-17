/**
 * Quiet mode: a console shown while the control plane behind it is still
 * being built.
 *
 * With NEXT_PUBLIC_CONSOLE_QUIET=1 at build time, a panel that could not read
 * its data says "Not connected on this deployment" in the same calm form a
 * screen ahead of its door already uses (components/pending.tsx), and the
 * reason the read failed is not printed. Nothing is invented in its place:
 * the panel is empty and says why in one line. Unset, every failure is shown
 * with its reason, which is what an operator of a connected deployment needs.
 */
export const QUIET = process.env.NEXT_PUBLIC_CONSOLE_QUIET === "1";

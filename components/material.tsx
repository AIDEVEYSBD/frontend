/**
 * Base material.
 *
 * Two layers, both achromatic. The distinction that matters: this adds
 * *tooth* and a light source, not decoration. There is no hue, no bloom,
 * and no shape you could point at — remove it and the page looks flat
 * rather than emptier.
 *
 *   1. Grain  — fractal noise, ~2.5% light / ~4% dark. Kills the plastic
 *               flatness of a solid fill; the thing print has and screens
 *               usually don't.
 *   2. Cast   — a single neutral tonal gradient from the top. Establishes
 *               one light direction so every shadow in the system agrees
 *               with the ground it sits on.
 */

/**
 * Scoped grain for a bounded surface (the navbar). Same noise as the
 * page material so the chrome shares the ground's tooth instead of
 * reading as a flat plate laid on top of it.
 */
export function SurfaceGrain({ id = "af-grain-surface" }: { id?: string }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full [mix-blend-mode:var(--material-grain-blend)] [opacity:var(--material-grain-chrome)]"
    >
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
        {/* Steel grey, not blue: barely cooler than neutral. Enough that
            the tooth reads as brushed metal rather than soot, not enough
            to register as a hue. */}
        <feColorMatrix
          type="matrix"
          values="0.945 0 0 0 0
                  0 0.965 0 0 0
                  0 0 1.00 0 0
                  0 0 0 1 0"
        />
        {/* Push the midtones apart so the tooth reads at a 48px height
            instead of averaging out to a flat wash. */}
        <feComponentTransfer>
          <feFuncR type="linear" slope="2.2" intercept="-0.6" />
          <feFuncG type="linear" slope="2.2" intercept="-0.6" />
          <feFuncB type="linear" slope="2.2" intercept="-0.6" />
        </feComponentTransfer>
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

export function Material() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Cast: neutral lift from above. No hue, no radius, no blob. */}
      <div className="absolute inset-0 [background:var(--material-cast)]" />

      {/* Grain */}
      <svg className="absolute inset-0 size-full [mix-blend-mode:var(--material-grain-blend)] [opacity:var(--material-grain)]">
        <filter id="af-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#af-grain)" />
      </svg>
    </div>
  );
}

import Image from "next/image";
import { Button, Status, Tag } from "./ui";

/**
 * Media rules for this product.
 *
 * Photography belongs on surfaces that persuade — the marketing shell,
 * a case study, an onboarding screen. It does not belong inside the
 * working product, where a photo behind a data table costs legibility
 * and buys nothing. Every image carries a real subject: a room, a team,
 * a document. Never an abstract render of a "neural network".
 */

/* ═══════════════════ Editorial hero ═══════════════════ */

export function MediaHero() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line">
      <div className="relative aspect-[21/9] w-full">
        <Image
          src="/media/hero.jpg"
          alt="Consultants reviewing documents around a table"
          fill
          sizes="(max-width: 1024px) 100vw, 900px"
          className="object-cover"
          priority
        />
        {/* Scrim, not a tint: a gradient that only darkens where text sits. */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,7,0.88)_0%,rgba(8,8,7,0.65)_42%,rgba(8,8,7,0.1)_75%)]" />
      </div>

      <div className="absolute inset-y-0 left-0 flex max-w-[54%] flex-col justify-center gap-3 p-6 sm:p-8">
        <span className="text-[11px] font-medium text-white/70">Case study</span>
        <h3 className="text-[clamp(18px,2.4vw,28px)] leading-[1.15] font-semibold tracking-[-0.02em] text-white">
          Four weeks from intake policy to a running claims agent
        </h3>
        <p className="max-w-[46ch] text-[13px] leading-[1.55] text-white/75">
          How a national insurer moved first-notice-of-loss onto Agent Factory without
          changing a single system of record.
        </p>
        <div className="pt-1">
          <Button size="sm" variant="solid" tone="neutral" className="!bg-white !text-[#0a0a09]">
            Read the case study
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Card with thumbnail ═══════════════════ */

export function MediaCard({
  src,
  alt,
  tag,
  title,
  meta,
}: {
  src: string;
  alt: string;
  tag: string;
  title: string;
  meta: string;
}) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[var(--shadow-2)]">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-raise">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 320px"
          className="object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex grow flex-col items-start gap-2 p-3.5">
        {/* items-start: a flex column would otherwise stretch the tag full width. */}
        <Tag>{tag}</Tag>
        <h4 className="text-[13.5px] leading-snug font-medium">{title}</h4>
        <span className="mt-auto text-[11.5px] text-faint">{meta}</span>
      </div>
    </article>
  );
}

/* ═══════════════════ Video ═══════════════════ */

export function MediaVideo() {
  return (
    <figure className="flex flex-col gap-2.5">
      <div className="relative overflow-hidden rounded-lg border border-line bg-sunken">
        {/*
          Product video is muted, looping and inline — it is an illustration,
          not entertainment. controls stay on so a viewer can stop it, and
          poster covers the frames before it decodes.
        */}
        <video
          className="aspect-video w-full object-cover"
          poster="/media/laptops.jpg"
          controls
          muted
          loop
          playsInline
          preload="metadata"
        >
          <source src="/media/workflow.mp4" type="video/mp4" />
          Your browser does not support embedded video.
        </video>
      </div>
      <figcaption className="flex items-center gap-2 text-[11.5px] text-faint">
        <Status tone="queue" dot={false}>
          02:14
        </Status>
        Walkthrough — composing a claims workflow from six harnesses
      </figcaption>
    </figure>
  );
}

/* ═══════════════════ Avatar from photo ═══════════════════ */

export function PhotoAvatar({
  src,
  name,
  size = 32,
}: {
  src: string;
  name: string;
  size?: number;
}) {
  return (
    <span
      className="relative inline-block shrink-0 overflow-hidden rounded-sm border border-line"
      style={{ width: size, height: size }}
      title={name}
    >
      <Image src={src} alt={name} fill sizes={`${size}px`} className="object-cover" />
    </span>
  );
}

/* ═══════════════════ Document thumbnail ═══════════════════ */

export function DocThumb({
  src,
  title,
  meta,
  pages,
}: {
  src: string;
  title: string;
  meta: string;
  pages: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-2.5">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-sm border border-line bg-raise">
        <Image src={src} alt="" fill sizes="56px" className="object-cover opacity-90" />
      </div>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-[12.5px] font-medium">{title}</span>
        <span className="truncate text-[11px] text-faint">{meta}</span>
      </div>
      <span className="tnum shrink-0 font-mono text-[11px] text-faint">{pages}p</span>
    </div>
  );
}

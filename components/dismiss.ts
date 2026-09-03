"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Every floating surface dismisses the same two ways: Escape, and a pointer
 * down outside it. One hook, so menus, dialogs, popovers and pickers cannot
 * drift apart on this.
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  close: () => void,
  external?: RefObject<T | null>,
): RefObject<T | null> {
  const own = useRef<T>(null);
  const ref = external ?? own;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);

  return ref;
}

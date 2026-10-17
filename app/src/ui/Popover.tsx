import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** omitted: follow the anchor, so a trigger on the right half opens leftwards instead of over the next card */
  align?: "start" | "end";
  offset?: number;
  /** opened from the keyboard: show at once */
  instant?: boolean;
};

/** Fixed-position popover anchored to an element; flips up when there's no room below. */
export function Popover({ anchor, open, onClose, children, align, offset = 6, instant }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean; ox: number } | null>(null);
  // after closing it stays 100ms to fade out (quicker than the entry), showing what it showed:
  // callers often clear the state its content was built from in the same click
  const [shown, setShown] = useState(open);
  const last = useRef(children);
  if (open) last.current = children;

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    // offset sizes: the entry animation is already scaling the box
    const p = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
    const up = a.bottom + offset + p.height > window.innerHeight - 8 && a.top - offset - p.height > 8;
    const end = (align ?? (a.left + a.width / 2 > window.innerWidth / 2 ? "end" : "start")) === "end";
    let x = end ? a.right - p.width : a.left;
    x = Math.max(8, Math.min(x, window.innerWidth - p.width - 8));
    // grow out of the trigger, wherever clamping put the box
    const ox = Math.max(0, Math.min(p.width, a.left + a.width / 2 - x));
    // when opening upwards pin the bottom edge, so filtering the list doesn't detach it from the anchor
    setPos({ x, y: up ? window.innerHeight - a.top + offset : a.bottom + offset, up, ox });
  }, [open, anchor, align, offset]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  useEffect(() => {
    if (open) return setShown(true);
    const id = setTimeout(() => (setShown(false), setPos(null)), 100);
    return () => clearTimeout(id);
  }, [open]);

  if (!open && !shown) return null;
  return createPortal(
    <div
      ref={ref}
      className="popover"
      data-up={pos?.up || undefined}
      data-instant={instant || undefined}
      // opacity, not visibility: a hidden element can't take focus, and menus autofocus their search field
      style={{
        left: pos?.x ?? 0,
        ...(pos?.up ? { bottom: pos.y } : { top: pos?.y ?? 0 }),
        opacity: pos && open ? 1 : 0,
        transformOrigin: pos ? `${pos.ox}px ${pos.up ? "100%" : "0"}` : undefined,
        pointerEvents: pos && open ? undefined : "none",
      }}
    >
      {open ? children : last.current}
    </div>,
    document.body,
  );
}

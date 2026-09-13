import { useEffect, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The app's one modal: a labelled dialog over a dimmed page. Focus moves in
 * when it opens and stays inside on Tab and Shift+Tab; Escape or a press on
 * the backdrop closes it; focus goes back to whatever opened it.
 */
export function Modal({
  labelledBy,
  describedBy,
  initialFocus,
  className = "",
  onClose,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  /** Focused on open; the dialog itself otherwise. */
  initialFocus?: RefObject<HTMLElement>;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocus?.current ?? dialog.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return close.current();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0] ?? dialog.current;
      const last = focusable[focusable.length - 1] ?? dialog.current;
      const active = document.activeElement;
      const atEdge = event.shiftKey ? active === first || active === dialog.current : active === last;
      if (atEdge || !dialog.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    // The page behind holds still: on a phone a swipe scrolls the dialog, never what it covers.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
    // Mount-only: `initialFocus` is read once, and `close` always holds the latest handler.
  }, []);

  return (
    <div
      className="vc-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className={`vc-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

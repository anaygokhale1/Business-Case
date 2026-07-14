"use client";

import {
  ReactNode,
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

export interface DialogProps {
  open: boolean;
  onClose: () => void; // fired by ESC, overlay mousedown, and close button
  labelledBy?: string; // id of the title element -> aria-labelledby
  describedBy?: string; // optional id -> aria-describedby
  initialFocusRef?: React.RefObject<HTMLElement | null>; // element focused on open
  closeOnOverlayClick?: boolean; // default true
  closeOnEsc?: boolean; // default true
  size?: "md" | "lg" | "xl" | "full"; // width preset; cog modal uses "xl"
  className?: string; // panel className override
  children: ReactNode;
}

const SIZE_MAX_WIDTH: Record<NonNullable<DialogProps["size"]>, string> = {
  md: "32rem",
  lg: "48rem",
  xl: "72rem",
  full: "100%",
};

// Selector covering the elements the focus trap should cycle through. Mirrors
// the standard "tabbable" set; the embedded admin workspaces contain many of
// these, so the query must be complete or the trap leaks focus to the page.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) {
    return false;
  }
  // `offsetParent` is the cheap visibility probe in real browsers, but jsdom
  // never lays out elements so it is always null there. Fall back to the
  // computed style + the hidden attribute, which jsdom does evaluate.
  if (el.offsetParent !== null) {
    return true;
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  initialFocusRef,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  size = "md",
  className,
  children,
}: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused before the dialog opened, so we can restore it on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  // Body scroll-lock: store and restore the prior overflow value.
  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Initial focus + focus restoration to the triggering element.
  useEffect(() => {
    if (!open) {
      return;
    }

    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusTarget =
      initialFocusRef?.current ??
      (panelRef.current ? getFocusable(panelRef.current)[0] : null) ??
      panelRef.current;
    focusTarget?.focus();

    return () => {
      triggerRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  // ESC to close + Tab focus-trap with wrap at both ends.
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEsc) {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) {
        // Nothing to focus inside; keep focus on the panel itself.
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, closeOnEsc, onClose]);

  if (!open) {
    return null;
  }

  // Close only when the mousedown originated on the overlay itself, never when
  // it bubbled up from the panel. Using mousedown (not click) avoids closing on
  // a drag that starts inside the panel and releases over the overlay.
  const handleOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  const panelStyle: CSSProperties = {
    maxWidth: SIZE_MAX_WIDTH[size],
    width: "100%",
    maxHeight: "90vh",
  };

  const overlay = (
    <div
      data-testid="dialog-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        style={panelStyle}
        className={
          className ??
          "flex max-h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl outline-none"
        }
      >
        {children}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

export function DialogTitle({ id, children }: { id: string; children: ReactNode }): ReactElement {
  return (
    <h2 id={id} className="text-lg font-bold tracking-tight text-slate-900">
      {children}
    </h2>
  );
}

export function DialogBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <div className={className ?? "min-h-0 flex-1 overflow-y-auto"}>{children}</div>;
}

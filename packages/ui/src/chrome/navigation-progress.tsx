"use client";

import { useEffect, useRef, useState } from "react";

import { useRouterAdapter } from "../router-adapter";

export function NavigationProgress() {
  const { usePathname } = useRouterAdapter();
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [completing, setCompleting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }

  function start() {
    clearTimers();
    setCompleting(false);
    setVisible(true);
    setWidth(12);
    intervalRef.current = setInterval(() => {
      setWidth(w => {
        if (w >= 82) { clearInterval(intervalRef.current!); intervalRef.current = null; return 82; }
        return w + Math.random() * 9 + 3;
      });
    }, 280);
  }

  function finish() {
    clearTimers();
    setCompleting(true);
    setWidth(100);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setWidth(0);
      setCompleting(false);
    }, 380);
  }

  /* Start on any internal link click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (href.startsWith("http") && !href.startsWith(window.location.origin)) return;
      start();
    }
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Finish when the pathname actually changes */
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[3px]">
      <div
        className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.55)]"
        style={{
          width: `${width}%`,
          transition: completing
            ? "width 200ms ease-out, opacity 300ms ease 150ms"
            : "width 400ms ease-out",
          opacity: completing && width === 100 ? 0 : 1,
        }}
      />
    </div>
  );
}

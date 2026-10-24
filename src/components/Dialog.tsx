"use client";

import { useEffect, useRef } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
  wide?: boolean;
  footer?: React.ReactNode;
}

/** Accessible modal: Escape closes, focus moves in and returns to the opener, background is inert. */
export default function Dialog({ title, onClose, children, testId, wide, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex='0']")];
      if (!items.length) return;
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
      else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
    };
    document.addEventListener("keydown", onKey);
    const main = document.getElementById("studio-root");
    main?.setAttribute("inert", "");
    return () => {
      document.removeEventListener("keydown", onKey);
      main?.removeAttribute("inert");
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        data-testid={testId}
        className={`print-area flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl outline-none sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 id="dialog-title" className="font-display text-xl">
            {title}
          </h2>
          <button type="button" data-close onClick={onClose} className="no-print ml-auto rounded-full px-2.5 py-1 text-sm text-muted hover:bg-canvas" aria-label="Close" data-testid="dialog-close">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="no-print border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

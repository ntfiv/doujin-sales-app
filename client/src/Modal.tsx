import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Native <dialog> modal (modern-web-guidance: dialog + focus
 * management). Rendered through a portal to <body> so it is never
 * clipped by list rows using content-visibility.
 *
 * - Opens with showModal(): focus is trapped in the dialog by the
 *   platform while it is open, and Esc closes it natively.
 * - Initial focus goes to the first field (input / select / textarea),
 *   or to an element marked [data-autofocus] when present.
 * - Clicking the backdrop (the dialog element itself, outside its
 *   framed content box) closes it.
 * - On close — however it was triggered — focus returns to the
 *   element that opened the dialog.
 *
 * The parent controls visibility with `open`; closing gestures call
 * `onClose`, and the parent unmounts the modal by setting open=false.
 */
export function Modal({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dlg = ref.current;
    if (!dlg) return;
    invokerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dlg.showModal();
    const target =
      dlg.querySelector<HTMLElement>("[data-autofocus]") ??
      dlg.querySelector<HTMLElement>("input, select, textarea");
    target?.focus();
    return () => {
      if (dlg.open) dlg.close();
      const invoker = invokerRef.current;
      if (invoker && document.contains(invoker)) invoker.focus();
      invokerRef.current = null;
    };
  }, [open ]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      aria-label={label}
      className="modal-panel"
      onClose={() => onCloseRef.current()}
      onClick={(e) => {
        // Backdrop click: the click lands on the dialog element
        // itself rather than on any of its content.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}

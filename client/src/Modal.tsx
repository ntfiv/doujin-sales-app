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
 *   framed content box) closes it. The padding lives on the inner
 *   .modal-frame wrapper, NOT on the dialog element: a tap in the
 *   padded margin around the content therefore lands on the frame
 *   and never counts as a backdrop click (with the padding on the
 *   dialog itself, the whole padded ring around the frame closed
 *   the dialog — reported 2026-11-17 for the イベントメモ editor).
 * - On close — however it was triggered — focus returns to the
 *   element that opened the dialog.
 *
 * The parent controls visibility with `open`; closing gestures call
 * `onClose`, and the parent unmounts the modal by setting open=false.
 */
export function Modal({
  open,
  onClose,
  closeVeto,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Optional Esc veto: when it returns true, the native Esc close
   * is prevented and the dialog stays open. For dialogs whose
   * onClose flushes state asynchronously (the イベントメモ
   * editor): Esc closes the dialog natively BEFORE onClose runs,
   * so a close guard that refuses (e.g. an unsavable URL is still
   * typed) would otherwise leave the parent believing the dialog
   * is open while it is already gone.
   */
  closeVeto?: () => boolean;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeVetoRef = useRef(closeVeto);
  closeVetoRef.current = closeVeto;

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
    const onCancel = (e: Event) => {
      if (closeVetoRef.current?.()) e.preventDefault();
    };
    dlg.addEventListener("cancel", onCancel);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
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
      <div className="modal-frame">{children}</div>
    </dialog>,
    document.body,
  );
}

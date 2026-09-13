import { useRef, type ReactNode } from "react";
import { Modal } from "./Modal";

/** A destructive action, confirmed in the app's own dialog. Cancel has focus, so Enter alone never destroys anything. */
export function ConfirmDialog({
  title,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** What happens, as paragraphs. */
  children: ReactNode;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      className="vc-confirm"
      labelledBy="vc-confirm-title"
      describedBy="vc-confirm-what"
      initialFocus={cancel}
      onClose={onClose}
    >
      <h2 id="vc-confirm-title">{title}</h2>
      <div id="vc-confirm-what" className="vc-confirm-body">
        {children}
      </div>
      <div className="vc-actions">
        <button ref={cancel} type="button" className="vc-button ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="vc-button danger"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

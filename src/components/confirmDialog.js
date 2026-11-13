/**
 * In-app confirmation dialog (replaces window.confirm). Uses the
 * `[data-confirm-modal]` markup from the app shell.
 *
 * @param {HTMLElement} modal
 * @returns {(opts: { title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }) => Promise<boolean>}
 *   Resolves true on confirm; false on Cancel, backdrop click or Escape.
 */
export function createConfirmDialog(modal) {
  const okBtn = modal.querySelector('[data-confirm-ok]');
  const cancelBtn = modal.querySelector('.modal-foot [data-confirm-cancel]');
  const titleEl = modal.querySelector('[data-confirm-title]');
  const messageEl = modal.querySelector('[data-confirm-message]');
  const cancelTargets = [...modal.querySelectorAll('[data-confirm-cancel]')];

  return function confirmDialog({
    title,
    message,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    danger = false,
  }) {
    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.classList.toggle('danger', danger);
    const returnFocus = document.activeElement;
    modal.hidden = false;
    // Focus Cancel so an accidental Enter never confirms
    cancelBtn.focus();

    return new Promise((resolve) => {
      const close = (result) => {
        modal.hidden = true;
        okBtn.removeEventListener('click', onOk);
        cancelTargets.forEach((n) => n.removeEventListener('click', onCancel));
        document.removeEventListener('keydown', onKey, true);
        returnFocus?.focus?.();
        resolve(result);
      };
      const onOk = () => close(true);
      const onCancel = () => close(false);
      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close(false);
      };
      okBtn.addEventListener('click', onOk);
      cancelTargets.forEach((n) => n.addEventListener('click', onCancel));
      document.addEventListener('keydown', onKey, true);
    });
  };
}

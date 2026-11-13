/** Sidebar overlay (Panel view hides the menu until the → button is pressed). */
export function createSidebar(ui) {
  const isOpen = () => !!ui.window?.classList.contains('sidebar-open');

  function setToggle(open) {
    if (!ui.menuToggle) return;
    const label = open ? 'Close menu' : 'Expand menu';
    ui.menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    ui.menuToggle.setAttribute('aria-label', label);
    ui.menuToggle.title = label;
    ui.menuToggle.textContent = open ? '←' : '→';
  }

  function open() {
    ui.window?.classList.add('sidebar-open');
    if (ui.sidebarBackdrop) ui.sidebarBackdrop.hidden = false;
    setToggle(true);
  }

  function close() {
    ui.window?.classList.remove('sidebar-open');
    if (ui.sidebarBackdrop) ui.sidebarBackdrop.hidden = true;
    setToggle(false);
  }

  ui.menuToggle?.addEventListener('click', () => (isOpen() ? close() : open()));
  ui.sidebarBackdrop?.addEventListener('click', close);

  return { open, close, isOpen };
}

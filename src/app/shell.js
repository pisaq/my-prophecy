/**
 * App window markup (titlebar, modals, sidebar, workspace) and references to
 * the elements the rest of the app talks to.
 */
import { MENU_GROUPS } from '../midi/params.js';

const channelOptions = Array.from(
  { length: 16 },
  (_, i) => `<option value="${i}">${i + 1}</option>`,
).join('');

function navItems(activeSection) {
  return MENU_GROUPS.map(
    (g) => `
      <button type="button" class="nav-item${g.id === activeSection ? ' active' : ''}" data-section="${g.id}">
        <span class="nav-icon">${g.icon}</span>
        <span>${g.label}</span>
      </button>`,
  ).join('');
}

function template(activeSection) {
  return `
    <canvas id="fractal" class="fractal" aria-hidden="true"></canvas>
    <div class="window">
      <header class="titlebar">
        <div class="title-left">
          <div class="traffic">
            <span class="dot close"></span>
            <span class="dot minimize"></span>
            <span class="dot zoom"></span>
          </div>
          <button type="button" class="menu-toggle" data-menu-toggle aria-label="Expand menu" title="Expand menu" aria-expanded="false">→</button>
        </div>
        <div class="title" title="My Prophecy — MIDI editor for the Sequential Prophet Rev2">
          <span class="brand">My Prophecy</span>
          <span class="subtitle"><span class="subtitle-for">for</span> Prophet Rev2</span>
        </div>
        <div class="title-actions">
          <button type="button" class="reset-all-btn" data-reset-all title="Reset every control to its default (or 0) and send it to the synth"><span class="reset-label">Reset All</span><span class="reset-busy" aria-hidden="true">Resetting…</span></button>
          <button type="button" class="notes-off-btn" data-notes-off title="Silence stuck notes — note-offs 0–127, then CC 120 / 123">Notes Off</button>
          <button type="button" class="pill" data-status aria-haspopup="dialog" title="MIDI connection">MIDI offline</button>
        </div>
      </header>
      <div class="modal-root" data-connection-modal hidden>
        <div class="modal-backdrop" data-close-connection></div>
        <div class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="connection-title">
          <header class="modal-head">
            <h2 id="connection-title">MIDI connection</h2>
            <button type="button" class="modal-close" data-close-connection aria-label="Close">✕</button>
          </header>
          <div class="modal-body">
            <label class="field">
              <span>Output</span>
              <select data-out class="mac-select"></select>
            </label>
            <label class="field">
              <span>Input</span>
              <select data-in class="mac-select"></select>
            </label>
            <div class="field-row">
              <label class="field">
                <span>Channel</span>
                <select data-channel class="mac-select">${channelOptions}</select>
              </label>
              <label class="field">
                <span>Mode</span>
                <select data-protocol class="mac-select">
                  <option value="cc">CC</option>
                  <option value="nrpn">NRPN</option>
                </select>
              </label>
              <label class="field">
                <span>Layer</span>
                <select data-layer class="mac-select">
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </label>
            </div>
            <p class="hint">Match Rev2 Global → MIDI Param Receive to Mode. MidiLink Mini should appear under Output / Input.</p>
            <p class="hint">See <button type="button" class="text-link" data-open-docs>MIDI Docs</button> for which controls send which CC / NRPN / notes.</p>
          </div>
          <footer class="modal-foot">
            <button type="button" class="primary-btn" data-close-connection>Done</button>
          </footer>
        </div>
      </div>
      <div class="modal-root confirm-modal" data-confirm-modal hidden>
        <div class="modal-backdrop" data-confirm-cancel></div>
        <div class="modal-sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
          <header class="modal-head">
            <h2 id="confirm-title" data-confirm-title></h2>
          </header>
          <div class="modal-body">
            <p class="confirm-message" id="confirm-message" data-confirm-message></p>
          </div>
          <footer class="modal-foot confirm-foot">
            <button type="button" class="ghost-btn" data-confirm-cancel>Cancel</button>
            <button type="button" class="primary-btn" data-confirm-ok>OK</button>
          </footer>
        </div>
      </div>
      <div class="modal-root section-modal" data-section-modal hidden>
        <div class="modal-backdrop" data-close-section-modal></div>
        <div class="modal-sheet section-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="section-modal-title">
          <header class="modal-head">
            <h2 id="section-modal-title" data-section-modal-title></h2>
            <button type="button" class="modal-close" data-close-section-modal aria-label="Close">✕</button>
          </header>
          <div class="modal-body section-modal-body" data-section-modal-body></div>
        </div>
      </div>
      <div class="body">
        <div class="sidebar-backdrop" data-sidebar-backdrop hidden></div>
        <aside class="sidebar" data-sidebar>
          <nav class="nav" data-nav>${navItems(activeSection)}</nav>
        </aside>
        <main class="main">
          <div class="main-head">
            <h1 data-section-title>Oscillators</h1>
            <p class="hint">Open the MIDI pill (top right) to pick ports. Match Rev2 Param Receive to CC or NRPN.</p>
          </div>
          <div class="workspace" data-workspace></div>
        </main>
      </div>
    </div>
  `;
}

/**
 * Render the shell into `root` and return element references.
 * @param {HTMLElement} root
 * @param {{ activeSection: string }} opts
 */
export function renderShell(root, { activeSection }) {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = template(activeSection);
  root.innerHTML = '';
  root.append(shell);

  const q = (sel) => root.querySelector(sel);
  return {
    root,
    fractal: q('#fractal'),
    window: q('.window'),
    sectionTitle: q('[data-section-title]'),
    workspace: q('[data-workspace]'),
    status: q('[data-status]'),
    resetAll: q('[data-reset-all]'),
    notesOff: q('[data-notes-off]'),
    connectionModal: q('[data-connection-modal]'),
    sectionModal: q('[data-section-modal]'),
    sectionModalTitle: q('[data-section-modal-title]'),
    sectionModalBody: q('[data-section-modal-body]'),
    confirmModal: q('[data-confirm-modal]'),
    menuToggle: q('[data-menu-toggle]'),
    sidebar: q('[data-sidebar]'),
    sidebarBackdrop: q('[data-sidebar-backdrop]'),
    outSelect: q('[data-out]'),
    inSelect: q('[data-in]'),
    channel: q('[data-channel]'),
    protocol: q('[data-protocol]'),
    layer: q('[data-layer]'),
    nav: q('[data-nav]'),
  };
}

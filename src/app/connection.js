/**
 * MIDI connection: Web MIDI access, port lists and auto-pick, the status pill
 * and the connection modal (output / input / channel / mode / layer).
 */
import { el } from '../components/controls.js';

const OWN_PORT = /my-prophecy|my-phophecy/i;
const SYNTH_PORT = /midilink|midiplus|usb|rev2|prophet|dsi|sequential/i;
const SAFARI = /^((?!chrome|android).)*safari/i;
const SAFARI_MIDI_URL = 'https://triglavmodular.hu/mods/safari-webmidi/';

/**
 * @param {object} ctx app context (midi, ui, saved, remember)
 * @param {{ onOpenDocs: () => void }} hooks
 */
export function createConnection(ctx, { onOpenDocs }) {
  const { midi, ui } = ctx;
  const modal = ui.connectionModal;

  const isOpen = () => !modal.hidden;

  function open() {
    modal.hidden = false;
    ui.status.setAttribute('aria-expanded', 'true');
    ui.outSelect?.focus();
  }

  function close() {
    modal.hidden = true;
    ui.status.setAttribute('aria-expanded', 'false');
  }

  function fillSelect(select, ports, emptyLabel) {
    const current = select.value;
    select.innerHTML = '';
    select.append(el('option', { value: '', text: emptyLabel }));
    ports.forEach((p) => select.append(el('option', { value: p.id, text: p.name })));
    if (current && ports.some((p) => p.id === current)) select.value = current;
  }

  function fillPorts(ports) {
    fillSelect(ui.outSelect, ports.outputs, 'No MIDI outputs');
    fillSelect(ui.inSelect, ports.inputs, 'No MIDI inputs');
  }

  /** Pick the last-used ports, else the likely synth interface. */
  function autoPick(ports) {
    const savedOut = ctx.saved?.connection?.outputName;
    const savedIn = ctx.saved?.connection?.inputName;
    const isSynth = (p) => SYNTH_PORT.test(p.name);
    const out =
      (savedOut && ports.outputs.find((p) => p.name === savedOut)) ||
      ports.outputs.find(isSynth) ||
      ports.outputs.find((p) => !OWN_PORT.test(p.name)) ||
      ports.outputs[0];
    const inn =
      (savedIn && ports.inputs.find((p) => p.name === savedIn)) ||
      ports.inputs.find(isSynth) ||
      ports.inputs.find((p) => !OWN_PORT.test(p.name)) ||
      ports.inputs[0];
    if (out) {
      ui.outSelect.value = out.id;
      midi.setOutput(out.id);
    }
    if (inn) {
      ui.inSelect.value = inn.id;
      midi.setInput(inn.id);
    }
    ctx.remember();
  }

  function updateStatus(detail) {
    if (detail.connected) {
      ui.status.textContent = `${detail.outputName} · ch ${detail.channel} · ${detail.protocol.toUpperCase()}`;
      ui.status.classList.remove('warn');
      ui.status.classList.add('ok');
    } else {
      ui.status.textContent = 'MIDI offline';
      ui.status.classList.remove('ok');
    }
  }

  function showUnsupported() {
    ui.status.textContent = 'Web MIDI unavailable';
    ui.status.classList.add('warn');
    const banner = el('div', { class: 'banner warn' });
    if (SAFARI.test(navigator.userAgent)) {
      banner.append(
        el('span', {
          text: 'Safari has no built-in Web MIDI. Install the free “Web MIDI for Safari” extension, enable it, then reload this page. ',
        }),
        el('a', {
          href: SAFARI_MIDI_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Download Web MIDI for Safari',
        }),
      );
    } else {
      banner.textContent =
        'This browser has no Web MIDI. Use Chrome, Edge, Firefox, or Safari with the Web MIDI extension.';
    }
    ui.workspace.prepend(banner);
  }

  async function connect() {
    const ports = await midi.connect();
    fillPorts(ports);
    autoPick(ports);
  }

  /** Ask for MIDI access; if the browser needs a click first, show a Connect banner. */
  async function boot() {
    if (!midi.supported) {
      showUnsupported();
      return;
    }
    try {
      await connect();
    } catch {
      ui.status.textContent = 'Allow MIDI access';
      ui.status.classList.add('warn');
      const banner = el('div', { class: 'banner warn' });
      banner.append(
        el('span', { text: 'Click Connect to grant MIDI access for your MidiLink Mini / Rev2. ' }),
      );
      const btn = el('button', { type: 'button', class: 'primary-btn', text: 'Connect MIDI' });
      btn.addEventListener('click', async () => {
        try {
          await connect();
          banner.remove();
        } catch (err) {
          ui.status.textContent = 'MIDI permission denied';
          console.warn(err);
        }
      });
      banner.append(btn);
      ui.workspace.prepend(banner);
    }
  }

  // —— wiring ——
  ui.status.addEventListener('click', () => (isOpen() ? close() : open()));
  modal.querySelectorAll('[data-close-connection]').forEach((node) => {
    node.addEventListener('click', close);
  });
  modal.querySelector('[data-open-docs]')?.addEventListener('click', () => {
    close();
    onOpenDocs();
  });

  ui.channel.value = String(midi.channel);
  ui.protocol.value = midi.protocol;
  ui.layer.value = midi.layer;
  ui.outSelect.addEventListener('change', () => {
    midi.setOutput(ui.outSelect.value || null);
    ctx.remember();
  });
  ui.inSelect.addEventListener('change', () => {
    midi.setInput(ui.inSelect.value || null);
    ctx.remember();
  });
  ui.channel.addEventListener('change', () => {
    midi.setChannel(ui.channel.value);
    ctx.remember();
  });
  ui.protocol.addEventListener('change', () => {
    midi.setProtocol(ui.protocol.value);
    ctx.remember();
  });
  ui.layer.addEventListener('change', () => {
    midi.setLayer(ui.layer.value);
    midi.requestEditBuffer(midi.layer);
    ctx.remember();
  });

  midi.addEventListener('ports', (e) => {
    fillPorts(e.detail);
  });
  midi.addEventListener('connection', (e) => {
    updateStatus(e.detail);
    ctx.remember();
  });

  return { open, close, isOpen, boot };
}

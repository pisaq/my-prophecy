import { GROUPS, PARAMS } from '../midi/params.js';
import { el } from '../components/controls.js';

const GROUP_LABELS = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

const EXTRA_FEATURES = [
  {
    feature: 'Programs · Layer A',
    midi: 'CC 32 + Program Change on base MIDI channel',
    notes: 'Needs MIDI Program Enable',
  },
  {
    feature: 'Programs · Layer B',
    midi: 'CC 32 + Program Change on base channel + 1',
    notes: 'Enable Global Multi Mode for independent A/B patches',
  },
  {
    feature: 'Programs · Recall A + B',
    midi: 'Both program changes (ch N and ch N+1)',
    notes: 'Then Stack or Split so both layers sound',
  },
  {
    feature: 'Test keys / Trackpad notes',
    midi: 'Note On (0x9n) / Note Off (0x8n + vel-0 Note On)',
    notes: 'Channel from connection modal',
  },
  {
    feature: 'Computer keyboard',
    midi: 'Note On / Off (same as test keys)',
    notes: 'Z–M + Q–I piano layout; [ ] or - = octave; ignored in text fields',
  },
  {
    feature: 'Gated sequencer',
    midi: 'NRPN 182–187 (mode/on/dests), 192–255 (4×16 steps); CC 19 type',
    notes: 'Step 0–125, 126 = Reset; hold a note to run; Panel strip + Sequencer page',
  },
  {
    feature: 'Trackpad companion',
    midi: 'Same note messages via virtual port “my-prophecy Trackpad”',
    notes: 'App MIDI Thru forwards Input → Output',
  },
  {
    feature: 'All Notes Off',
    midi: 'Note Off 0–127, then CC 120 + CC 123',
    notes: 'Dock “Notes Off” — Rev2 often ignores bare CC 123 alone',
  },
  {
    feature: 'Pitch wheel',
    midi: 'Pitch Bend (0xEn), 14-bit from 0–127 UI → center 64',
    notes: 'Panel left wheel',
  },
  {
    feature: 'Hold',
    midi: 'CC 64 (Sustain)',
    notes: 'Panel Hold control',
  },
  {
    feature: 'Transpose',
    midi: 'App-side note offset (−2…+2 octaves)',
    notes: 'Does not send a Rev2 param; shifts outgoing notes',
  },
  {
    feature: 'Layer A / B',
    midi: 'NRPN address +2048 for Layer B',
    notes: 'Connection modal Layer selector',
  },
];

function midiForParam(param) {
  if (param.special === 'pitchBend') return 'Pitch Bend (0xEn)';
  if (param.special === 'hold') return 'CC 64';
  if (param.special === 'transpose') return '— (app note offset)';

  const bits = [];
  if (param.cc != null) bits.push(`CC ${param.cc}`);
  if (param.nrpn != null) {
    bits.push(`NRPN ${param.nrpn}`);
    bits.push(`Layer B ${param.nrpn + 2048}`);
  }
  return bits.length ? bits.join(' · ') : '—';
}

function rangeForParam(param) {
  if (param.type === 'enum' && param.options) {
    return `0–${param.max} (${param.options.length} values)`;
  }
  if (param.type === 'toggle') return '0 / 1';
  let r = `${param.min}–${param.max}`;
  if (param.ccMax != null && param.ccMax !== param.max) {
    r += ` (CC scaled 0–${param.ccMax})`;
  }
  return r;
}

function protocolNote(param) {
  if (param.special) return 'Special';
  if (param.cc != null && param.nrpn != null) return 'CC or NRPN';
  if (param.nrpn != null) return 'NRPN (also if Mode=CC)';
  if (param.cc != null) return 'CC';
  return '—';
}

/** In-app MIDI command reference, generated from the live parameter map. */
export function createMidiDocsPanel() {
  const panel = el('section', { class: 'panel midi-docs-panel' });
  panel.append(el('h2', { class: 'panel-title', text: 'MIDI command map' }));
  panel.append(
    el('p', {
      class: 'hint',
      text: 'What each control sends. Mode in the connection modal chooses CC vs NRPN when both exist. NRPN-only controls always use NRPN. Match Rev2 Global → MIDI Param Receive.',
    }),
  );

  const toc = el('div', { class: 'midi-docs-toc' });
  toc.append(
    el('a', { href: '#midi-docs-features', text: 'App features' }),
    el('a', { href: '#midi-docs-params', text: 'Parameters by section' }),
    el('a', {
      href: 'https://github.com/search?q=prophet+rev2+midi&type=repositories',
      target: '_blank',
      rel: 'noopener noreferrer',
      text: 'External Rev2 MIDI refs',
    }),
  );
  panel.append(toc);

  // Features
  const feat = el('section', { id: 'midi-docs-features', class: 'midi-docs-block' });
  feat.append(el('h3', { text: 'App features' }));
  feat.append(
    table(
      ['Feature', 'MIDI', 'Notes'],
      EXTRA_FEATURES.map((r) => [r.feature, r.midi, r.notes]),
    ),
  );
  panel.append(feat);

  // Params by group
  const paramsBlock = el('section', { id: 'midi-docs-params', class: 'midi-docs-block' });
  paramsBlock.append(el('h3', { text: 'Parameters by section' }));

  const byGroup = new Map();
  for (const p of PARAMS) {
    if (!byGroup.has(p.group)) byGroup.set(p.group, []);
    byGroup.get(p.group).push(p);
  }

  const order = [
    'oscillators',
    'filter',
    'amp',
    'env3',
    'lfos',
    'modulation',
    'fx',
    'arp',
    'voice',
  ];

  for (const groupId of order) {
    const list = byGroup.get(groupId);
    if (!list?.length) continue;
    const block = el('div', { class: 'midi-docs-group' });
    block.append(el('h4', { text: GROUP_LABELS[groupId] || groupId }));
    block.append(
      table(
        ['Control', 'MIDI', 'Range', 'When'],
        list.map((p) => [p.label, midiForParam(p), rangeForParam(p), protocolNote(p)]),
      ),
    );
    paramsBlock.append(block);
  }

  panel.append(paramsBlock);

  return panel;
}

function table(headers, rows) {
  const wrap = el('div', { class: 'midi-docs-table-wrap' });
  const tableEl = el('table', { class: 'midi-docs-table' });
  const thead = el('thead');
  const hr = el('tr');
  headers.forEach((h) => hr.append(el('th', { text: h })));
  thead.append(hr);
  tableEl.append(thead);
  const tbody = el('tbody');
  rows.forEach((cols) => {
    const tr = el('tr');
    cols.forEach((c, i) => {
      tr.append(el('td', { class: i === 1 ? 'mono' : '', text: c }));
    });
    tbody.append(tr);
  });
  tableEl.append(tbody);
  wrap.append(tableEl);
  return wrap;
}

import {
  PARAMS,
  PARAMS_BY_CC,
  PARAMS_BY_NRPN,
  fromCcValue,
  isLayerParam,
  toCcValue,
} from './params.js';

const LAYER_PARAMS = PARAMS.filter(isLayerParam);
import { editBufferRequestBytes, parseEditBufferDump, valuesFromDump } from './sysex.js';
import { TRACKPAD_PORT } from './trackpadApi.js';

const CC_NRPN_MSB = 99;
const CC_NRPN_LSB = 98;
const CC_DATA_MSB = 6;
const CC_DATA_LSB = 38;

export class MidiEngine extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.output = null;
    this.input = null;
    this.channel = 0; // 0–15
    this.protocol = 'cc'; // 'cc' | 'nrpn'
    this.layer = 'A'; // 'A' | 'B'
    /** Values shown/edited now: the active layer's patch params + shared params. */
    this.values = new Map();
    /** Each layer's own patch-param values, so switching A↔B keeps both. */
    this.layerValues = { A: new Map(), B: new Map() };
    /** @type {Set<number>} notes this app currently holds on the active channel */
    this.activeNotes = new Set();
    /** Forward Note On/Off from the selected Input → Output. */
    this.midiThru = true;
    /**
     * The companion's “my-prophecy Trackpad” port. Listened to on its own, so
     * trackpad notes always reach the selected Output whatever Input is chosen.
     * @type {MIDIInput|null}
     */
    this.trackpadInput = null;
    this._onTrackpadMessage = (e) => this.forwardTrackpad([...e.data]);
    this._nrpnState = { msb: 0, lsb: 0, dataMsb: 0 };
    this._log = [];
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._dumpWait = null;
    /** Layer to apply when the next edit-buffer dump arrives. */
    this._pendingDumpLayer = null;
    /** @type {((program: number[]) => void)[]} callers waiting for the raw dump */
    this._dumpWaiters = [];
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }

  async connect() {
    if (!this.supported) {
      throw new Error('Web MIDI is not available. Use Chrome or Edge on macOS.');
    }
    this.access = await navigator.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => {
      this.#attachTrackpad();
      this.#emitPorts();
    };
    this.#attachTrackpad();
    this.#emitPorts();
    return this.ports();
  }

  ports() {
    if (!this.access) return { inputs: [], outputs: [] };
    return {
      inputs: [...this.access.inputs.values()].map(portMeta),
      outputs: [...this.access.outputs.values()].map(portMeta),
    };
  }

  setOutput(id) {
    if (this.output) this.output = null;
    this.output = id ? this.access.outputs.get(id) : null;
    this.dispatchEvent(new CustomEvent('connection', { detail: this.status() }));
  }

  setInput(id) {
    if (this.input) this.input.onmidimessage = null;
    this.input = id ? this.access.inputs.get(id) : null;
    if (this.input) {
      this.input.onmidimessage = (e) => this.#onMessage(e);
    }
    this.dispatchEvent(new CustomEvent('connection', { detail: this.status() }));
  }

  setChannel(ch) {
    this.channel = Math.max(0, Math.min(15, Number(ch)));
    this.dispatchEvent(new CustomEvent('connection', { detail: this.status() }));
  }

  setProtocol(protocol) {
    this.protocol = protocol === 'nrpn' ? 'nrpn' : 'cc';
    this.dispatchEvent(new CustomEvent('connection', { detail: this.status() }));
  }

  setLayer(layer, { notifySynth = false } = {}) {
    const next = layer === 'B' ? 'B' : 'A';
    const changed = next !== this.layer;
    if (changed) {
      const leaving = this.layerValues[this.layer];
      const entering = this.layerValues[next];
      for (const p of LAYER_PARAMS) {
        // What the leaving layer showed — including params still at their default
        const shown = this.values.has(p.id) ? this.values.get(p.id) : (p.defaultValue ?? p.min);
        if (!leaving.has(p.id)) leaving.set(p.id, shown);
        // The entering layer shows its own value; a layer never seen starts as a copy
        const value = entering.has(p.id) ? entering.get(p.id) : shown;
        entering.set(p.id, value);
        this.values.set(p.id, value);
      }
    }
    this.layer = next;
    // Global NRPN 4190 selects which layer the Rev2 front panel edits (0=A, 1=B)
    if (notifySynth && this.output) {
      this.#sendNrpnRaw(4190, this.layer === 'B' ? 1 : 0);
    }
    if (changed) this.dispatchEvent(new CustomEvent('layer', { detail: { layer: next } }));
  }

  /** One layer's patch-param values as a plain object. */
  getLayerValues(layer) {
    const L = layer === 'B' ? 'B' : 'A';
    const out = {};
    for (const p of LAYER_PARAMS) {
      const store = this.layerValues[L];
      if (L !== this.layer && store.has(p.id)) out[p.id] = store.get(p.id);
      else if (this.values.has(p.id)) out[p.id] = this.values.get(p.id);
      else if (store.has(p.id)) out[p.id] = store.get(p.id);
    }
    return out;
  }

  /** Restore saved per-layer values, then show the active layer's. */
  restoreLayerValues(saved) {
    for (const L of ['A', 'B']) {
      const src = saved?.[L];
      if (!src || typeof src !== 'object') continue;
      for (const p of LAYER_PARAMS) {
        const v = src[p.id];
        if (Number.isFinite(v)) this.layerValues[L].set(p.id, clamp(Math.round(v), p.min, p.max));
      }
    }
    const store = this.layerValues[this.layer];
    for (const p of LAYER_PARAMS) {
      if (store.has(p.id)) this.values.set(p.id, store.get(p.id));
    }
  }

  setMidiThru(enabled) {
    this.midiThru = !!enabled;
    this.dispatchEvent(new CustomEvent('connection', { detail: this.status() }));
  }

  status() {
    return {
      outputId: this.output?.id ?? null,
      outputName: this.output?.name ?? null,
      inputId: this.input?.id ?? null,
      inputName: this.input?.name ?? null,
      channel: this.channel + 1,
      protocol: this.protocol,
      layer: this.layer,
      connected: !!this.output,
      midiThru: this.midiThru,
    };
  }

  getValue(paramId, fallback = 0) {
    return this.values.has(paramId) ? this.values.get(paramId) : fallback;
  }

  /**
   * @param {{ silent?: boolean, fromHardware?: boolean, layer?: 'A'|'B' }} [opts]
   *   `layer` targets a specific layer; values for the non-active layer are
   *   only stored (no UI event, no MIDI out).
   */
  setParam(param, value, { silent = false, fromHardware = false, layer = this.layer } = {}) {
    const v = clamp(Math.round(value), param.min, param.max);
    if (isLayerParam(param)) {
      this.layerValues[layer === 'B' ? 'B' : 'A'].set(param.id, v);
      if (layer !== this.layer) return;
    }
    this.values.set(param.id, v);

    if (!fromHardware) {
      if (param.special === 'pitchBend') {
        this.sendPitchBend(v);
      } else if (param.special === 'hold') {
        this.sendHold(!!v);
      } else if (param.special === 'transpose') {
        // Local only — applied when sending notes from the app
      } else if (this.output) {
        if (this.protocol === 'nrpn' && param.nrpn != null) {
          this.#sendNrpn(param.nrpn, v, { global: !!param.global });
        } else if (param.cc != null) {
          this.#sendCc(param.cc, toCcValue(param, v));
          // A/B Mode etc. — also send NRPN so it works when Param Receive is NRPN-only
          if (param.global && param.nrpn != null) {
            this.#sendNrpn(param.nrpn, v, { global: true });
          }
        } else if (param.nrpn != null) {
          // NRPN-only params still send NRPN even in CC protocol mode
          this.#sendNrpn(param.nrpn, v, { global: !!param.global });
        }
      }
    }

    if (!silent) {
      this.dispatchEvent(
        new CustomEvent('param', {
          detail: { param, value: v, fromHardware },
        }),
      );
    }
    return v;
  }

  /** Octave transpose from the panel (−2…+2). */
  noteTransposeSemitones() {
    return (this.getValue('transpose', 0) || 0) * 12;
  }

  /**
   * Bank select (CC32) + Program Change.
   * @param {number} bank 0–7 (U1–U4, F1–F4)
   * @param {number} program 0–127
   * @param {{ channel?: number }} [opts] 0–15; default = connection channel.
   *   Layer B on the Rev2 (Multi Mode) is usually base channel + 1.
   */
  sendProgram(bank, program, { channel } = {}) {
    if (!this.output) return;
    const ch = channel != null ? clamp(channel, 0, 15) : this.channel;
    this.#sendCc(32, clamp(bank, 0, 7), ch);
    const bytes = [0xc0 | ch, clamp(program, 0, 127)];
    this.output.send(bytes);
    this.#pushLog('out', bytes, `Program bank ${bank} pgm ${program} ch${ch + 1}`);
  }

  /** Recall Layer A on base channel and Layer B on base+1 (Multi Mode). */
  sendDualProgram(a, b) {
    this.sendProgram(a.bank, a.program, { channel: this.channel });
    const chB = Math.min(15, this.channel + 1);
    this.sendProgram(b.bank, b.program, { channel: chB });
  }

  sendNoteOn(note, velocity = 100, { applyTranspose = true } = {}) {
    if (!this.output) return;
    const shifted = applyTranspose ? note + this.noteTransposeSemitones() : note;
    const n = clamp(shifted, 0, 127);
    const v = clamp(velocity, 1, 127);
    const bytes = [0x90 | this.channel, n, v];
    this.output.send(bytes);
    this.activeNotes.add(n);
    this.#pushLog('out', bytes, `Note On ${n}`);
    return n;
  }

  sendNoteOff(note, { applyTranspose = true } = {}) {
    if (!this.output) return;
    const shifted = applyTranspose ? note + this.noteTransposeSemitones() : note;
    const n = clamp(shifted, 0, 127);
    // Note-off + velocity-0 note-on — some hosts/synths only honor one form
    this.output.send([0x80 | this.channel, n, 0]);
    this.output.send([0x90 | this.channel, n, 0]);
    this.activeNotes.delete(n);
    this.#pushLog('out', [0x80 | this.channel, n, 0], `Note Off ${n}`);
  }

  /** Pitch bend: value 0–127 maps to MIDI 14-bit (center 64 → 8192). */
  sendPitchBend(value0to127) {
    if (!this.output) return;
    const v = clamp(value0to127, 0, 127);
    const bend = Math.round((v / 127) * 16383);
    const lsb = bend & 0x7f;
    const msb = (bend >> 7) & 0x7f;
    const bytes = [0xe0 | this.channel, lsb, msb];
    this.output.send(bytes);
    this.#pushLog('out', bytes, `Pitch Bend ${v}`);
  }

  /** Sustain / Hold pedal (CC 64). */
  sendHold(on) {
    this.#sendCc(64, on ? 127 : 0);
  }

  /**
   * Notes Off: Rev2 often ignores bare CC 123 alone.
   * Explicit note-offs for the whole range, then All Sound Off + All Notes Off.
   */
  allNotesOff() {
    if (!this.output) return;
    const ch = this.channel;
    for (let n = 0; n <= 127; n++) {
      this.output.send([0x80 | ch, n, 0]);
      this.output.send([0x90 | ch, n, 0]);
    }
    this.activeNotes.clear();
    this.#sendCc(120, 0); // All Sound Off
    this.#sendCc(123, 0); // All Notes Off
    this.#pushLog('out', [], 'Notes Off — note-offs + CC120/123');
  }

  /**
   * Ask the Rev2 for its current edit-buffer dump, then apply that layer into values/UI.
   * Requires MIDI In from the synth. Globals → MIDI Sysex Cable must match the
   * port you selected here (USB ↔ Rev2 USB, MIDI ↔ DIN interface).
   * @param {'A'|'B'} [layer] defaults to the active edit layer
   */
  requestEditBuffer(layer = this.layer) {
    if (!this.output) {
      this.#pushLog('out', [], 'Edit buffer request skipped — no MIDI Out');
      return false;
    }
    if (!this.input) {
      this.#pushLog('out', [], 'Edit buffer request skipped — no MIDI In (needed for dump)');
      return false;
    }
    this._pendingDumpLayer = layer === 'B' ? 'B' : 'A';
    if (this._dumpWait) clearTimeout(this._dumpWait);
    this._dumpWait = setTimeout(() => {
      this._dumpWait = null;
      if (this._pendingDumpLayer) {
        this.#pushLog(
          'in',
          [],
          `No dump for Layer ${this._pendingDumpLayer} — Sysex Cable must match this port (MIDI=DIN, USB=Rev2 USB); MIDI In required`,
        );
        this._pendingDumpLayer = null;
        this.dispatchEvent(new CustomEvent('dump', { detail: { ok: false, layer } }));
      }
    }, 2500);
    const bytes = editBufferRequestBytes();
    this.output.send(bytes);
    this.#pushLog('out', bytes, `Request edit buffer (apply Layer ${this._pendingDumpLayer})`);
    return true;
  }

  /**
   * Request the edit buffer and resolve with the raw unpacked program bytes
   * (both layers), or null if the synth doesn't answer.
   * @returns {Promise<number[] | null>}
   */
  fetchEditBuffer(timeoutMs = 2500) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (program) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this._dumpWaiters = this._dumpWaiters.filter((fn) => fn !== finish);
        resolve(program);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this._dumpWaiters.push(finish);
      if (!this.requestEditBuffer(this.layer)) finish(null);
    });
  }

  /**
   * Apply an unpacked dump into local values (no MIDI echo).
   * @param {number[]} programData
   * @param {'A'|'B'} layer
   */
  applyEditBuffer(programData, layer) {
    // The dump holds both layers — keep the other one too
    const other = layer === 'B' ? 'A' : 'B';
    for (const [id, value] of Object.entries(valuesFromDump(programData, other, PARAMS))) {
      const param = PARAMS.find((p) => p.id === id);
      if (param && isLayerParam(param)) {
        this.setParam(param, value, { silent: true, fromHardware: true, layer: other });
      }
    }
    const values = valuesFromDump(programData, layer, PARAMS);
    let count = 0;
    for (const [id, value] of Object.entries(values)) {
      const param = PARAMS.find((p) => p.id === id);
      if (!param) continue;
      this.setParam(param, value, { silent: true, fromHardware: true, layer });
      count++;
    }
    this.#pushLog('in', [], `Applied Layer ${layer} dump (${count} params)`);
    this.dispatchEvent(new CustomEvent('dump', { detail: { ok: true, layer, count, values } }));
    return count;
  }

  #sendCc(cc, value, channel = this.channel) {
    if (!this.output) return;
    const ch = clamp(channel, 0, 15);
    const bytes = [0xb0 | ch, cc, clamp(value, 0, 127)];
    this.output.send(bytes);
    this.#pushLog('out', bytes, `CC ${cc} = ${value} ch${ch + 1}`);
  }

  #sendNrpn(nrpn, value, { global = false } = {}) {
    if (!this.output) return;
    const address = !global && this.layer === 'B' ? nrpn + 2048 : nrpn;
    this.#sendNrpnRaw(address, value);
    this.#pushLog(
      'out',
      [],
      global
        ? `NRPN ${address} = ${value} (global)`
        : `NRPN ${address} = ${value} (Layer ${this.layer})`,
    );
  }

  /** Send NRPN at an absolute address (no Layer B +2048 offset). */
  #sendNrpnRaw(address, value) {
    if (!this.output) return;
    const nMsb = (address >> 7) & 0x7f;
    const nLsb = address & 0x7f;
    const vMsb = (value >> 7) & 0x7f;
    const vLsb = value & 0x7f;
    this.#sendCc(CC_NRPN_MSB, nMsb);
    this.#sendCc(CC_NRPN_LSB, nLsb);
    this.#sendCc(CC_DATA_MSB, vMsb);
    this.#sendCc(CC_DATA_LSB, vLsb);
  }

  #onMessage(event) {
    const data = [...event.data];
    const status = data[0];
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xf0) {
      this.#onSysex(data);
      return;
    }

    // Thru: mirror notes from a controller on Input to the Rev2. The trackpad
    // port has its own listener, so skip it here or its notes would double.
    if (this.midiThru && event.currentTarget !== this.trackpadInput) {
      this.#forwardNote(data, 'Thru');
    }

    if (type === 0xb0) {
      const cc = data[1];
      const value = data[2];
      this.#pushLog('in', data, `CC ${cc} = ${value} ch${channel + 1}`);

      if (cc === CC_NRPN_MSB) this._nrpnState.msb = value;
      else if (cc === CC_NRPN_LSB) this._nrpnState.lsb = value;
      else if (cc === CC_DATA_MSB) this._nrpnState.dataMsb = value;
      else if (cc === CC_DATA_LSB) {
        const address = (this._nrpnState.msb << 7) | this._nrpnState.lsb;
        const nrpnValue = (this._nrpnState.dataMsb << 7) | value;
        const layerA = address >= 2048 ? address - 2048 : address;
        const param = PARAMS_BY_NRPN[layerA];
        if (param) {
          // Layer B params arrive at +2048
          const layer = address >= 2048 ? 'B' : 'A';
          this.setParam(param, nrpnValue, { fromHardware: true, layer });
        }
      } else {
        const param = PARAMS_BY_CC[cc];
        if (param) {
          this.setParam(param, fromCcValue(param, value), { fromHardware: true });
        }
      }
      return;
    }

    if (type === 0xc0) {
      this.#pushLog('in', data, `Program ${data[1]} ch${channel + 1}`);
      this.dispatchEvent(new CustomEvent('program', { detail: { program: data[1], channel } }));
      return;
    }

    this.#pushLog('in', data, describeMidi(data));
  }

  #onSysex(data) {
    const program = parseEditBufferDump(data);
    if (!program) {
      this.#pushLog('in', data, `SysEx (${data.length} bytes)`);
      return;
    }
    this.#pushLog('in', data, `Edit buffer dump (${program.length} unpacked bytes)`);
    if (this._dumpWait) {
      clearTimeout(this._dumpWait);
      this._dumpWait = null;
    }
    const layer = this._pendingDumpLayer || this.layer;
    this._pendingDumpLayer = null;
    this.applyEditBuffer(program, layer);
    [...this._dumpWaiters].forEach((fn) => fn(program));
  }

  /** Send a trackpad Note On/Off to the selected Output. */
  forwardTrackpad(data) {
    this.#forwardNote(data, 'Trackpad');
  }

  #forwardNote(data, label) {
    const type = data[0] & 0xf0;
    if (!this.output || (type !== 0x90 && type !== 0x80)) return;
    const note = data[1];
    const vel = data[2] ?? 0;
    if (type === 0x90 && vel > 0) {
      this.output.send([0x90 | this.channel, note, vel]);
      this.activeNotes.add(note);
      this.#pushLog('thru', data, `${label} Note On ${note}`);
    } else {
      this.output.send([0x80 | this.channel, note, 0]);
      this.output.send([0x90 | this.channel, note, 0]);
      this.activeNotes.delete(note);
      this.#pushLog('thru', data, `${label} Note Off ${note}`);
    }
  }

  /** Listen to the companion's virtual port while it exists. */
  #attachTrackpad() {
    const port =
      [...this.access.inputs.values()].find(
        (p) => p.state !== 'disconnected' && TRACKPAD_PORT.test(p.name),
      ) ?? null;
    if (port === this.trackpadInput) return;
    this.trackpadInput?.removeEventListener('midimessage', this._onTrackpadMessage);
    this.trackpadInput = port;
    if (port) {
      port.addEventListener('midimessage', this._onTrackpadMessage);
      port.open?.();
    }
  }

  #emitPorts() {
    this.dispatchEvent(new CustomEvent('ports', { detail: this.ports() }));
  }

  #pushLog(dir, bytes, text) {
    const entry = {
      t: performance.now(),
      dir,
      bytes,
      text,
      stamp: new Date().toLocaleTimeString(),
    };
    this._log.push(entry);
    if (this._log.length > 200) this._log.shift();
    this.dispatchEvent(new CustomEvent('log', { detail: entry }));
  }

  get log() {
    return this._log;
  }
}

function portMeta(port) {
  return {
    id: port.id,
    name: port.name,
    manufacturer: port.manufacturer,
    state: port.state,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function describeMidi(data) {
  const status = data[0];
  const type = status & 0xf0;
  if (type === 0x90) return `Note On ${data[1]} vel ${data[2]}`;
  if (type === 0x80) return `Note Off ${data[1]}`;
  if (type === 0xe0) return `Pitch Bend`;
  if (status === 0xf0) return `SysEx (${data.length} bytes)`;
  return data.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

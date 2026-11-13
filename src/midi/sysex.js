/**
 * Prophet Rev2 SysEx edit-buffer dump helpers.
 * Manufacturer 0x01 (DSI/Sequential), family 0x2F (Rev2).
 * Packed MS-bit format + Layer B offset from KnobKraft / Sequential docs.
 */

export const DSI_ID = 0x01;
export const REV2_ID = 0x2f;
export const MSG_EDIT_BUFFER_DUMP = 0x03;
export const MSG_REQUEST_EDIT_BUFFER = 0x06;
export const LAYER_B_OFFSET = 1024;

/**
 * NRPN (Layer A) → unpacked program-data byte index.
 * Source: KnobKraft-orm Rev2Patch.cpp (validated against dumps).
 */
export const SYSEX_INDEX_BY_NRPN = {
  0: 0,
  1: 2,
  2: 4,
  3: 8,
  4: 10,
  5: 1,
  6: 3,
  7: 5,
  8: 9,
  9: 11,
  10: 17,
  11: 18,
  12: 21,
  13: 14,
  14: 16,
  15: 22,
  16: 23,
  17: 24,
  18: 25,
  19: 26,
  20: 32,
  21: 35,
  22: 38,
  23: 41,
  24: 44,
  25: 47,
  26: 50,
  28: 29,
  29: 28,
  30: 33,
  31: 36,
  32: 39,
  33: 42,
  34: 45,
  35: 48,
  36: 51,
  37: 53,
  38: 57,
  39: 61,
  40: 65,
  41: 69,
  42: 54,
  43: 58,
  44: 62,
  45: 66,
  46: 70,
  47: 55,
  48: 59,
  49: 63,
  50: 67,
  51: 71,
  52: 56,
  53: 60,
  54: 64,
  55: 68,
  56: 72,
  57: 30,
  58: 34,
  59: 37,
  60: 40,
  61: 43,
  62: 46,
  63: 49,
  64: 52,
  65: 77,
  66: 85,
  67: 93,
  68: 78,
  69: 86,
  70: 94,
  71: 79,
  72: 87,
  73: 95,
  74: 80,
  75: 88,
  76: 96,
  77: 81,
  78: 89,
  79: 97,
  80: 82,
  81: 90,
  82: 98,
  83: 83,
  84: 91,
  85: 99,
  86: 84,
  87: 92,
  88: 100,
  97: 31,
  98: 27,
  99: 12,
  102: 6,
  103: 7,
  104: 13,
  105: 73,
  106: 74,
  107: 75,
  108: 76,
  110: 15,
  111: 19,
  113: 20,
  114: 209,
  116: 101,
  117: 102,
  118: 103,
  119: 104,
  120: 105,
  121: 106,
  122: 107,
  123: 108,
  124: 109,
  125: 110,
  153: 116,
  154: 115,
  155: 117,
  156: 118,
  157: 119,
  158: 120,
  163: 231,
  167: 208,
  168: 123,
  169: 124,
  170: 122,
  171: 232,
  172: 136,
  173: 132,
  174: 133,
  175: 131,
  177: 134,
  178: 135,
  179: 130,
  182: 138,
  /** Gated/Poly select (docs disagree on “on/off” vs “mode”; KnobKraft uses 137). */
  183: 137,
  184: 111,
  185: 112,
  186: 113,
  187: 114,
};

// Gated seq steps: consecutive NRPNs → consecutive sysex bytes
for (let track = 0; track < 4; track++) {
  const nrpn0 = 192 + track * 16;
  const sx0 = 140 + track * 16;
  for (let step = 0; step < 16; step++) {
    SYSEX_INDEX_BY_NRPN[nrpn0 + step] = sx0 + step;
  }
}

/** Seq Type (Gated/Poly) lives at sysex 137 (NRPN 183 naming differs across docs). */
export const SEQ_TYPE_SYSEX_INDEX = 137;

/** Request current program edit buffer dump. */
export function editBufferRequestBytes() {
  return [0xf0, DSI_ID, REV2_ID, MSG_REQUEST_EDIT_BUFFER, 0xf7];
}

/**
 * Unpack DSI “packed MS bit” MIDI bytes → raw program bytes.
 * @param {number[]} packed
 * @param {number} [expectedLength=2046]
 */
export function unpackMsBits(packed, expectedLength = 2046) {
  const out = [];
  let i = 0;
  while (i < packed.length && out.length < expectedLength) {
    const msBits = packed[i++];
    for (let b = 0; b < 7 && out.length < expectedLength; b++) {
      if (i >= packed.length) break;
      out.push(packed[i++] | ((msBits & (1 << b)) << (7 - b)));
    }
  }
  while (out.length < expectedLength) out.push(0);
  return out;
}

/**
 * @param {number[]} data Full SysEx including F0…F7 or payload after F0
 * @returns {number[]|null} Unpacked 2046-byte program (Layer A + Layer B)
 */
export function parseEditBufferDump(data) {
  if (!data?.length) return null;
  let bytes = data[0] === 0xf0 ? data.slice(1) : data.slice();
  if (bytes[bytes.length - 1] === 0xf7) bytes = bytes.slice(0, -1);
  if (bytes.length < 4) return null;
  if (bytes[0] !== DSI_ID || bytes[1] !== REV2_ID || bytes[2] !== MSG_EDIT_BUFFER_DUMP) {
    return null;
  }
  return unpackMsBits(bytes.slice(3), 2046);
}

/** Patch-level params stored only in the Layer A half of the dump. */
const SHARED_NRPNS = new Set([163]); // A/B Mode

/**
 * Read a layer’s parameter values from unpacked dump into a Map of paramId → value.
 * @param {number[]} programData
 * @param {'A'|'B'} layer
 * @param {import('./params.js').Param[]} params
 */
export function valuesFromDump(programData, layer, params) {
  const layerOffset = layer === 'B' ? LAYER_B_OFFSET : 0;
  /** @type {Record<string, number>} */
  const values = {};
  for (const param of params) {
    if (param.nrpn == null) continue;
    const sx = SYSEX_INDEX_BY_NRPN[param.nrpn];
    if (sx == null) continue;
    const offset = SHARED_NRPNS.has(param.nrpn) ? 0 : layerOffset;
    const raw = programData[offset + sx];
    if (raw == null) continue;
    values[param.id] = Math.max(param.min, Math.min(param.max, raw));
  }
  // Seq Type (CC-only in our map) shares the gated/poly byte
  const seqType = programData[layerOffset + SEQ_TYPE_SYSEX_INDEX];
  if (seqType != null) {
    values.seq_type = seqType ? 1 : 0;
  }
  return values;
}

/** Program name: 20 ASCII chars at this index of the (Layer A) program data. */
const NAME_INDEX = 235;
const NAME_LENGTH = 20;

/**
 * Read the program name from an unpacked edit-buffer dump.
 * Returns null unless every byte is printable ASCII (guards against a wrong
 * offset on other firmware).
 * @param {number[]} programData
 * @param {'A'|'B'} [layer]
 */
export function programNameFromDump(programData, layer = 'A') {
  const start = (layer === 'B' ? LAYER_B_OFFSET : 0) + NAME_INDEX;
  const bytes = programData?.slice(start, start + NAME_LENGTH);
  if (!bytes || bytes.length < NAME_LENGTH) return null;
  if (!bytes.every((b) => b >= 32 && b <= 126)) return null;
  const name = String.fromCharCode(...bytes).trim();
  return name || null;
}

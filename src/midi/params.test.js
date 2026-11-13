import { describe, expect, it } from 'vitest';
import {
  MENU_GROUPS,
  PANEL_LAYOUT,
  PARAMS,
  PARAMS_BY_ID,
  fromCcValue,
  isLayerParam,
  toCcValue,
} from './params.js';

const layoutIds = (sections) =>
  sections.flatMap((s) => [
    ...(s.rows || []).flatMap((r) => r.ids),
    ...(s.sections ? layoutIds(s.sections) : []),
  ]);

describe('PARAMS', () => {
  it('has unique ids and sane ranges', () => {
    const ids = PARAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PARAMS) {
      expect(p.max, p.id).toBeGreaterThan(p.min);
      if (p.defaultValue != null) {
        expect(p.defaultValue, p.id).toBeGreaterThanOrEqual(p.min);
        expect(p.defaultValue, p.id).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('every control on the Panel exists', () => {
    const ids = [
      ...layoutIds([...PANEL_LAYOUT.topRow, ...PANEL_LAYOUT.voiceRow]),
      ...PANEL_LAYOUT.wheels,
      ...Object.values(PANEL_LAYOUT.performance).flat(),
    ];
    expect(ids.filter((id) => !PARAMS_BY_ID[id])).toEqual([]);
  });

  it('menu only lists the top-level pages', () => {
    expect(MENU_GROUPS.map((g) => g.id)).toEqual([
      'panel',
      'patches',
      'audio',
      'saveload',
      'monitor',
      'docs',
    ]);
  });
});

describe('CC scaling', () => {
  const cutoff = PARAMS_BY_ID.filter_cutoff; // 0–164 over CC 0–127

  it('scales wide-range params into 0–127 and back', () => {
    expect(toCcValue(cutoff, 0)).toBe(0);
    expect(toCcValue(cutoff, cutoff.max)).toBe(127);
    expect(fromCcValue(cutoff, 127)).toBeCloseTo(cutoff.max, 0);
  });

  it('passes 0–127 params through unchanged', () => {
    const p = PARAMS.find((x) => x.max === 127 && (x.ccMax ?? x.max) === 127);
    expect(toCcValue(p, 64)).toBe(64);
  });
});

describe('isLayerParam', () => {
  it('excludes globals and performance controls', () => {
    expect(isLayerParam(PARAMS_BY_ID.filter_cutoff)).toBe(true);
    expect(isLayerParam(PARAMS_BY_ID.ab_mode)).toBe(false);
    expect(isLayerParam(PARAMS_BY_ID.pitch_bend)).toBe(false);
    expect(isLayerParam(PARAMS_BY_ID.mod_wheel)).toBe(false);
    expect(isLayerParam(PARAMS_BY_ID.master_volume)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { PARAMS_BY_ID } from '../midi/params.js';
import { compactParamLabel } from './paramLabels.js';

const label = (section, id) => compactParamLabel(section, PARAMS_BY_ID[id]).label;

describe('compactParamLabel', () => {
  it('names the sequencer switch On, not Gated', () => {
    expect(label('seq_ctrl', 'gated_on')).toBe('On');
    expect(label('seq_ctrl', 'seq_type')).toBe('Type');
    expect(label('seq_ctrl', 'gated_mode')).toBe('Mode');
  });

  it('drops the row prefix on LFO and oscillator controls', () => {
    expect(label('lfos', 'lfo3_shape')).toBe('Shape');
    expect(label('lfos', 'lfo1_dest')).toBe('Dest');
    expect(label('oscillators', 'osc2_fine')).toBe('Fine');
  });

  it('returns a copy and leaves the shared param untouched', () => {
    const param = PARAMS_BY_ID.lfo1_freq;
    const before = param.label;
    expect(compactParamLabel('lfos', param)).not.toBe(param);
    expect(param.label).toBe(before);
  });
});

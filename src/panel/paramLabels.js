/**
 * Short control labels for the Panel — the strip already names the row, so
 * "Osc 1 Freq" becomes "Freq" etc. Returns a copy of the param when relabelled.
 */
export function compactParamLabel(sectionId, param) {
  if (
    sectionId === 'rate' ||
    sectionId === 'clock' ||
    sectionId === 'arp' ||
    sectionId === 'seq_ctrl'
  ) {
    const map = {
      glide_mode: 'Mode',
      osc1_glide: 'Rate',
      glide_on: 'Glide',
      bpm: 'BPM',
      clock_div: 'Divide',
      arp_mode: 'Mode',
      arp_range: 'Range',
      arp_repeats: 'Repeat',
      seq_type: 'Type',
      gated_on: 'On',
      gated_mode: 'Mode',
    };
    if (map[param.id]) {
      // Name on the button (Glide / Arp / On) — no On label above On/Off
      return { ...param, label: map[param.id] };
    }
  }
  if (sectionId === 'oscillators') {
    const map = {
      osc1_freq: 'Freq',
      osc1_fine: 'Fine',
      osc1_shape: 'Shape',
      osc1_shape_mod: 'Shape Mod',
      osc1_glide: 'Glide',
      osc2_freq: 'Freq',
      osc2_fine: 'Fine',
      osc2_shape: 'Shape',
      osc2_shape_mod: 'Shape Mod',
      osc2_glide: 'Glide',
      osc_sync: 'Sync',
      osc_mix: 'Mix',
      sub_osc: 'Sub',
      noise: 'Noise',
      slop: 'Slop',
    };
    if (map[param.id]) return { ...param, label: map[param.id] };
  }
  if (sectionId === 'filter_amp' || sectionId === 'filter' || sectionId === 'amp') {
    const map = {
      filter_cutoff: 'Cutoff',
      filter_res: 'Res',
      filter_key: 'Key',
      filter_audio_mod: 'Audio',
      filter_poles: '4 Pole',
      filter_env_amt: 'Amount',
      filter_env_vel: 'Velocity',
      filter_delay: 'Delay',
      filter_attack: 'Attack',
      filter_decay: 'Decay',
      filter_sustain: 'Sustain',
      filter_release: 'Release',
      vca_level: 'Level',
      pan_spread: 'Pan',
      program_volume: 'Volume',
      amp_env_amt: 'Amount',
      amp_env_vel: 'Velocity',
      amp_delay: 'Delay',
      amp_attack: 'Attack',
      amp_decay: 'Decay',
      amp_sustain: 'Sustain',
      amp_release: 'Release',
    };
    if (map[param.id]) return { ...param, label: map[param.id] };
  }
  if (sectionId === 'lfos') {
    const kind = param.id.split('_')[1];
    const map = {
      freq: 'Freq',
      shape: 'Shape',
      amt: 'Amount',
      dest: 'Dest',
      clk: 'Clock',
      key: 'Key',
    };
    if (map[kind]) {
      const next = { ...param, label: map[kind] };
      if (kind === 'clk' || kind === 'key') next.labelAbove = true;
      return next;
    }
  }
  if (sectionId === 'env3' || param.id.startsWith('env3_')) {
    const map = {
      env3_dest: 'Destination',
      env3_amt: 'Amount',
      env3_vel: 'Velocity',
      env3_delay: 'Delay',
      env3_attack: 'Attack',
      env3_decay: 'Decay',
      env3_sustain: 'Sustain',
      env3_release: 'Release',
      env3_repeat: 'Repeat',
    };
    if (map[param.id]) return { ...param, label: map[param.id] };
  }
  if (param.id.startsWith('fx_')) {
    const map = {
      fx_on: 'On',
      fx_type: 'Type',
      fx_mix: 'Mix',
      fx_param1: 'Param 1',
      fx_param2: 'Param 2',
      fx_clk: 'Clock Sync',
    };
    if (map[param.id]) return { ...param, label: map[param.id] };
  }
  return param;
}

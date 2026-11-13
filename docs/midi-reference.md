# my-prophecy MIDI reference

What each feature/control sends to the Sequential Prophet Rev2.

Set **Global → MIDI Param Receive** on the synth to match the app **Mode** (CC or NRPN). NRPN-only controls always send NRPN. Layer **B** adds **2048** to NRPN addresses.

Open the same map in the app: sidebar → **MIDI Docs**.

## App features

| Feature                    | MIDI                                       | Notes                                                                     |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Programs · Layer A         | CC 32 + Program Change on base channel     | Needs MIDI Program Enable                                                 |
| Programs · Layer B         | CC 32 + Program Change on base channel + 1 | Enable Global Multi Mode                                                  |
| Programs · Recall A + B    | Both PCs on ch N and N+1                   | Use Stack/Split to hear both                                              |
| Test keys / Trackpad notes | Note On / Note Off                         | Channel from connection modal                                             |
| Computer keyboard          | Note On / Note Off                         | Z–M + Q–I piano layout; `[` `]` or `-` `=` octave; ignored in text fields |
| Gated sequencer            | NRPN 182–187, 192–255; CC 19 type          | Steps 0–125, 126 = Reset; hold a note to run                              |
| Trackpad companion         | Notes via “my-prophecy Trackpad”           | MIDI Thru → Output                                                        |
| Notes Off                  | Note Off 0–127, CC 120, CC 123             | Dock button — silences stuck notes                                        |
| Pitch wheel                | Pitch Bend (0xEn)                          | UI 0–127, center 64                                                       |
| Hold                       | CC 64                                      | Sustain                                                                   |
| Transpose                  | App-side note offset                       | −2…+2 octaves                                                             |
| Layer A / B                | NRPN +0 / +2048                            | Connection modal                                                          |

## Parameters

Generated from `src/midi/params.js`. Prefer the in-app **MIDI Docs** page for the live table (CC, NRPN, ranges).

### Protocol behaviour

- **Mode = CC:** send CC when mapped; NRPN-only params still send NRPN.
- **Mode = NRPN:** prefer NRPN when mapped.
- **NRPN format:** CC 99/98 (number) then CC 6/38 (value), 14-bit.

### External charts

- [midi.guide · Prophet Rev2](https://midi.guide/d/sequential/prophet-rev2/)
- [Sunshine Jones CC chart](https://sunshine-jones.com/prophet-rev2-preliminary-midi-implementation-chart/)
- [Sequential Rev2 User’s Guide · Appendix E](https://www.sequential.com/wp-content/uploads/2021/02/Prophet-Rev2-Users-Guide-1.2.4.pdf)

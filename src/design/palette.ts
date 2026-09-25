/**
 * Chicory bloom: roasted-coffee darks, cream, and chicory-flower periwinkle.
 *
 * Outside Settings a colour is often the only word a state gets, so each one
 * means one thing everywhere (REDESIGN.md 3.1): sage is done, bloom is in
 * flight, honey needs attention, radish failed, and slate stands in for bloom
 * on a test network so play money never looks like real money. A number that
 * matters holds 7:1 against the surface it sits on (the contrast column in
 * REDESIGN.md 3.1); dust sits near 4.5:1 and never carries one.
 */
export const palette = {
  // Surfaces, back to front. Husk and bark are decorative strokes only.
  roast: '#110E0C',
  espresso: '#1A1512',
  mocha: '#241D19',
  cocoa: '#2F2621',
  husk: '#3D332C',
  bark: '#4A3E36',

  // Ink. QR codes are always ink on cream.
  cream: '#F3ECDF',
  steam: '#B9AD9E',
  dust: '#8C8174',
  ink: '#1C1511',

  // The bloom, tip to centre.
  bloom: '#8FA5E4',
  bloomHi: '#A9BAEE',
  bloomDeep: '#6F88CF',
  bloomNight: '#4F66AD',
  stamen: '#3E4F8F',

  // Semantics.
  sage: '#9FD4A6',
  honey: '#F2C46B',
  radish: '#FF8373',
  slate: '#9AA0AE',

  // Soft fills, for a disc or chip that carries a state behind its glyph.
  bloomSoft: '#282933',
  sageSoft: '#2B3228',
  honeySoft: '#3A2F1D',
  radishSoft: '#3C231F',
  creamSoft: '#3A3632',

  // Washes, one step quieter than the soft fills.
  bloomWash: '#202026',
  sageWash: '#22261E',
  honeyWash: '#2C2417',
  radishWash: '#2E1C18',

  // Money on its way: bloom at 35%, so it reads as the same money, not yet
  // solid.
  glass: 'rgba(143,165,228,0.35)',
  scrim: 'rgba(17,14,12,0.88)',
} as const;

/**
 * The top pane's layers (REDESIGN.md 3.2), as data for react-native-svg
 * gradients. Positions are fractions of the pane; periods are milliseconds.
 * G1 and G2 drift in opposite phase so the light never settles into a
 * pattern, and only transform and opacity ever move.
 */
export const gradients = {
  G0: {
    kind: 'linear',
    angle: 180,
    stops: [
      { offset: 0, color: '#17131B', opacity: 1 },
      { offset: 1, color: palette.roast, opacity: 1 },
    ],
  },
  G1: {
    kind: 'radial',
    cx: 0.5,
    cy: 0.4,
    r: 0.6,
    stops: [
      { offset: 0, color: palette.bloomNight, opacity: 0.28 },
      { offset: 0.6, color: '#2A2A45', opacity: 0.12 },
      { offset: 1, color: '#2A2A45', opacity: 0 },
    ],
    drift: { x: 0.06, y: 0.04, period: 18000, rotate: 8, spin: 26000 },
  },
  G2: {
    kind: 'radial',
    cx: 0.8,
    cy: 0.9,
    r: 0.5,
    stops: [
      { offset: 0, color: '#6B4A33', opacity: 0.18 },
      { offset: 1, color: '#6B4A33', opacity: 0 },
    ],
    drift: { period: 22000 },
  },
  /** State tints. One shows at a time, crossfading over `crossfade`. */
  G3: {
    crossfade: 600,
    honey: { color: palette.honey, opacity: 0.1 },
    sageFlash: { color: palette.sage, opacity: 0.22, in: 300, out: 900 },
    radish: { color: palette.radish, opacity: 0.14, hold: 1200 },
    night: { color: '#3B4A7A', opacity: 0.1 },
  },
} as const;

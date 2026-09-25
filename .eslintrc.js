const VISIBLE_COPY =
  'Visible copy belongs in Settings; carry meaning with glyphs and put words in accessibility props (REDESIGN.md rule 1)';

module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // The canvas and everything drawn on it show data, never prose.
      files: ['src/stage/**', 'src/glyphs/**', 'src/scenes/**'],
      // Until the phase views are redrawn.
      excludedFiles: ['src/scenes/phases/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: 'JSXText[value=/[A-Za-z]{2,}/]', message: VISIBLE_COPY },
          {
            selector: "JSXAttribute[name.name='placeholder']",
            message: VISIBLE_COPY,
          },
        ],
      },
    },
  ],
};

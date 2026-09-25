const VISIBLE_COPY =
  'Visible copy belongs in Settings; carry meaning with glyphs and put words in accessibility props (REDESIGN.md rule 1)';

module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // The canvas and everything drawn on it show data, never prose: no
      // words as JSX text, as a string or template literal child, or as a
      // placeholder.
      files: ['src/stage/**', 'src/glyphs/**', 'src/scenes/**'],
      excludedFiles: [
        // Settings-class surfaces keep their words (REDESIGN.md rule 2).
        'src/scenes/settings/**',
        // Until the phases track redraws the phase views.
        'src/scenes/phases/**',
        // Until the home track replaces the banner with the halo and the
        // shield tile.
        'src/scenes/shared/BackupBanner.tsx',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          { selector: 'JSXText[value=/[A-Za-z]{2,}/]', message: VISIBLE_COPY },
          {
            selector:
              'JSXElement > JSXExpressionContainer > Literal[value=/[A-Za-z]{2,}/]',
            message: VISIBLE_COPY,
          },
          {
            selector:
              'JSXElement > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=/[A-Za-z]{2,}/]',
            message: VISIBLE_COPY,
          },
          {
            selector: "JSXAttribute[name.name='placeholder']",
            message: VISIBLE_COPY,
          },
        ],
      },
    },
  ],
};

/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#212f35',
    tint: '#2b5f69',

    background: '#f5f1ea',
    foreground: '#212f35',
    card: '#faf8f5',
    cardForeground: '#212f35',
    primary: '#2b5f69',
    primaryForeground: '#f8f6f2',
    secondary: '#e3dbce',
    secondaryForeground: '#212f35',
    muted: '#e9e4dd',
    mutedForeground: '#657881',
    accent: '#d0996d',
    accentForeground: '#212f35',
    destructive: '#bd4032',
    destructiveForeground: '#f8f6f2',
    border: '#dfd8ce',
    input: '#d7cec1',
  },

  dark: {
    text: '#f5f1ea',
    tint: '#7dbdca',
    background: '#182026',
    foreground: '#f5f1ea',
    card: '#212a31',
    cardForeground: '#f5f1ea',
    primary: '#7dbdca',
    primaryForeground: '#131b20',
    secondary: '#343f46',
    secondaryForeground: '#f5f1ea',
    muted: '#303a41',
    mutedForeground: '#a2acb3',
    accent: '#d0996d',
    accentForeground: '#131b20',
    destructive: '#d26256',
    destructiveForeground: '#131b20',
    border: '#38444c',
    input: '#414e58',
  },

  radius: 12,
};

export default colors;

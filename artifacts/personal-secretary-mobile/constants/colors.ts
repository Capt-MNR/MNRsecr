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
    text: '#213039',
    tint: '#2b6871',

    background: '#f3f0e9',
    foreground: '#213039',
    card: '#fbfaf8',
    cardForeground: '#213039',
    primary: '#2b6871',
    primaryForeground: '#f9f7f2',
    secondary: '#e0d9ca',
    secondaryForeground: '#213039',
    muted: '#e7e3db',
    mutedForeground: '#65727a',
    accent: '#d39c76',
    accentForeground: '#213039',
    destructive: '#bf4f41',
    destructiveForeground: '#f9f7f2',
    border: '#ded9cf',
    input: '#d8d1c6',
  },

  dark: {
    text: '#f3f0e9',
    tint: '#72b5bd',
    background: '#131a1f',
    foreground: '#f3f0e9',
    card: '#212a30',
    cardForeground: '#f3f0e9',
    primary: '#72b5bd',
    primaryForeground: '#131a1f',
    secondary: '#3a464d',
    secondaryForeground: '#f3f0e9',
    muted: '#344047',
    mutedForeground: '#a5afb5',
    accent: '#d39c76',
    accentForeground: '#131a1f',
    destructive: '#d96e60',
    destructiveForeground: '#131a1f',
    border: '#3a464d',
    input: '#45525a',
  },

  radius: 8,
};

export default colors;

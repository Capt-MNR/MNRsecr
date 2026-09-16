import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import colors from '@/constants/colors';

export type ThemePreference = 'light' | 'dark';

type ThemeContextValue = {
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
};

const THEME_STORAGE_KEY = '@personal-secretary-mobile/theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('light');

  useEffect(() => {
    void AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') setThemePreferenceState(stored);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    themePreference,
    setThemePreference: (nextTheme) => {
      setThemePreferenceState(nextTheme);
      void AsyncStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    },
  }), [themePreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemePreference must be used inside ThemeProvider');
  return context;
}

/**
 * Returns the design tokens for the manually selected color scheme.
 */
export function useColors() {
  const { themePreference } = useThemePreference();
  const palette = themePreference === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
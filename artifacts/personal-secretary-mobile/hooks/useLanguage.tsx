import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

export type AppLanguage = 'ar' | 'en';

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
};

const LANGUAGE_STORAGE_KEY = '@personal-secretary-mobile/language';
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>('ar');

  useEffect(() => {
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
      if (stored === 'ar' || stored === 'en') setLanguageState(stored);
    });
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: (nextLanguage) => {
      setLanguageState(nextLanguage);
      void AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    },
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
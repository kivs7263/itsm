'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import ko, { type Messages } from '@/messages/ko';
import en from '@/messages/en';

export type Locale = 'ko' | 'en';

const STORAGE_KEY = 'itsm.locale';

const MESSAGES: Record<Locale, Messages> = { ko, en };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'ko',
  setLocale: () => {},
  t: ko,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ko');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored === 'ko' || stored === 'en') setLocaleState(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: MESSAGES[locale] }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

// Convenience: typed path accessor via dot notation proxy
// Usage: const { t } = useLocale(); t.nav.dashboard

import { createContext, useContext, type ReactNode } from "react";
import { STRINGS, type Locale, type StringKey } from "./strings";

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();

  return (key: StringKey, fallback?: string): string => {
    return STRINGS[locale][key] ?? STRINGS.en[key] ?? fallback ?? key;
  };
}

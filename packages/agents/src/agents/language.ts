import type { Language } from "@cortex/shared";

const NAMES: Record<Language, string> = { es: "Spanish", en: "English" };

export function languageName(language: Language): string {
  return NAMES[language];
}

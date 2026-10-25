import { en } from './en';
import { es } from './es';
import { pt } from './pt';
import { lt } from './lt';
import { zh } from './zh';
import { hi } from './hi';
import { ar } from './ar';
import { ja } from './ja';
import { de } from './de';
import { ru } from './ru';
import { fr } from './fr';
import { ko } from './ko';
import { yo } from './yo';
import { am } from './am';
import { sw } from './sw';
import { sr } from './sr';
import { sl } from './sl';
import { hr } from './hr';

export type Language = 'en' | 'es' | 'pt' | 'lt' | 'zh' | 'hi' | 'ar' | 'ja' | 'de' | 'ru' | 'fr' | 'ko' | 'yo' | 'am' | 'sw' | 'sr' | 'sl' | 'hr';

export type TranslationKeys = keyof typeof en;

export const translations = {
  en,
  es,
  pt,
  lt,
  zh,
  hi,
  ar,
  ja,
  de,
  ru,
  fr,
  ko,
  yo,
  am,
  sw,
  sr,
  sl,
  hr,
};

export const languageNames: Record<Language, string> = {
  en: 'English (US)',
  es: 'Español',
  pt: 'Português',
  lt: 'Lietuvių',
  zh: '中文（简体）',
  hi: 'हिंदी',
  ar: 'العربية',
  ja: '日本語',
  de: 'Deutsch',
  ru: 'Русский',
  fr: 'Français',
  ko: '한국어',
  yo: 'Yorùbá',
  am: 'አማርኛ',
  sw: 'Kiswahili',
  sr: 'Српски',
  sl: 'Slovenščina',
  hr: 'Hrvatski'
};

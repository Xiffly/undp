export type SupportedLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  dir: 'ltr' | 'rtl';
  master: boolean;
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", flag: "GB", dir: "ltr", master: true },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "AR", dir: "rtl", master: false },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "FR", dir: "ltr", master: false },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "ES", dir: "ltr", master: false },
  { code: "ru", label: "Russian", nativeLabel: "Русский", flag: "RU", dir: "ltr", master: false },
  { code: "zh", label: "Chinese", nativeLabel: "中文", flag: "CN", dir: "ltr", master: false },
];

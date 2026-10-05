import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown } from 'lucide-react';
import { SUPPORTED_LANGUAGES, getLanguageMeta } from '../config/languages';

export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = getLanguageMeta(i18n.language);

  const switchTo = (code: string) => {
    const meta = getLanguageMeta(code);
    i18n.changeLanguage(meta.code);
    document.documentElement.setAttribute('dir', meta.dir);
    document.documentElement.setAttribute('lang', meta.code);
    localStorage.setItem('undp_language', meta.code);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-blue-100 hover:bg-white/10 text-sm transition-colors"
        aria-label="Switch language"
      >
        <Globe size={14} />
        {!compact && <span className="hidden sm:inline">{current.flag} {current.nativeLabel}</span>}
        {compact && <span>{current.flag}</span>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1 min-w-[160px]">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => switchTo(lang.code)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
                  current.code === lang.code
                    ? 'bg-un-light text-un-blue font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span>{lang.nativeLabel}</span>
                {current.code === lang.code && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-un-blue" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

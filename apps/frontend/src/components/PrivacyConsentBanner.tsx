import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useConsent } from '../consent/useConsent';

export default function PrivacyConsentBanner() {
  const { t } = useTranslation();
  const location = useLocation();
  const { loading, requiresPrompt, setConsentChoice } = useConsent();

  if (loading || !requiresPrompt || location.pathname.startsWith('/admin')) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[1200] border-t border-un-blue/20 bg-un-dark/95 px-4 py-4 text-white shadow-[0_-12px_32px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-un-blue/90">
            <ShieldCheck size={16} />
            <span>{t('consent.title', { defaultValue: 'Privacy and governance choices' })}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
          <button
            type="button"
            onClick={() => setConsentChoice('decline')}
            className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t('consent.decline', { defaultValue: 'Decline' })}
          </button>
          <button
            type="button"
            onClick={() => setConsentChoice('necessary_only')}
            className="rounded-xl border border-un-blue/50 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t('consent.necessary_only', { defaultValue: 'Necessary Only' })}
          </button>
          <button
            type="button"
            onClick={() => setConsentChoice('accept_all')}
            className="rounded-xl bg-un-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
          >
            {t('consent.accept_all', { defaultValue: 'Accept All' })}
          </button>
        </div>
      </div>
    </div>
  );
}

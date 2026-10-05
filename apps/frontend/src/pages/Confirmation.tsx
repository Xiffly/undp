import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Share2, Copy, MapPin, Clock } from 'lucide-react';

export default function Confirmation() {
  const { t } = useTranslation();
  const { state } = useLocation();
  const reportId: string = state?.reportId || 'CR-????-????';
  const isQueued = reportId === 'QUEUED';
  const queuedForAccount = Boolean(state?.queuedForAccount);
  const moderation = state?.moderation as { flags?: string[]; review_required?: boolean } | undefined;
  const shareText = t('confirmation.share_text', {
    defaultValue: 'I reported crisis damage using the UNDP Crisis Reporter platform. Reference: {{reportId}}.',
    reportId,
  });

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('confirmation.share_title', { defaultValue: 'UNDP Crisis Reporter' }),
          text: shareText,
          url: window.location.origin,
        });
      } catch {
        return;
      }
    }
  };

  const copy = () => navigator.clipboard.writeText(reportId).catch(() => {});

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <div className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full ${isQueued ? 'bg-amber-100' : 'bg-green-100'}`}>
        {isQueued
          ? <Clock size={40} className="text-amber-500" />
          : <CheckCircle size={40} className="text-green-500" />
        }
      </div>

      <h1 className="mb-2 text-2xl font-bold text-gray-900">
        {isQueued ? t('confirmation.queued_title') : t('confirmation.success_title')}
      </h1>

      <p className="mb-6 text-sm text-gray-500">
        {isQueued
          ? t('confirmation.device_queued_subtitle', {
              defaultValue: 'Your report has been stored locally in this browser on this device. It will sync when connectivity returns, or the next time you reopen the site if background sync is not available.',
            })
          : t('confirmation.success_detail', {
              defaultValue: 'Thank you for contributing to crisis response. UNDP teams will review your report and coordinate aid accordingly.',
            })}
      </p>

      {!isQueued && (
        <div className="mb-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">{t('confirmation.reference')}</p>
          <div className="flex items-center justify-center gap-2">
            <p className="font-mono text-lg font-bold text-gray-800">{reportId}</p>
            <button
              onClick={copy}
              className="text-gray-400 transition-colors hover:text-gray-600"
              title={t('confirmation.copy')}
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {t('confirmation.keep_reference', { defaultValue: 'Keep this for your records.' })}
          </p>
        </div>
      )}

      {!isQueued && moderation?.flags?.length ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
          <p className="mb-1 text-sm font-semibold text-amber-800">
            {t('confirmation.safeguards_title', { defaultValue: 'Review safeguards applied' })}
          </p>
          <p className="text-xs text-amber-700">
            {t('confirmation.safeguards_body', {
              defaultValue: 'This report was routed for additional review because it matched one or more automated abuse-control checks.',
            })}
          </p>
        </div>
      ) : null}

      {isQueued && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-700">
            {t('confirmation.waiting_connection', { defaultValue: 'Waiting for connection' })}
          </p>
          <p className="mt-1 text-xs text-amber-600">
            {t('confirmation.waiting_connection_detail', {
              defaultValue: queuedForAccount
                ? 'This queued report is stored locally in this browser and linked to your signed-in account on this device. Supported browsers may sync it in the background; otherwise it will resume when you reopen the site.'
                : 'This queued report is stored locally in this browser on this device. Supported browsers may sync it in the background; otherwise it will resume when you reopen the site.',
            })}
          </p>
        </div>
      )}

      {!isQueued && (
        <div className="mb-6 rounded-2xl bg-blue-50 p-4 text-left">
          <p className="mb-2 text-sm font-semibold text-un-dark">{t('confirmation.what_next')}</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-un-blue">1.</span>
              <span>{t('confirmation.review_step_1', { defaultValue: 'Your report is reviewed by UNDP assessment teams.' })}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-un-blue">2.</span>
              <span>{t('confirmation.review_step_2', { defaultValue: 'Damage is verified and prioritised for response.' })}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-un-blue">3.</span>
              <span>{t('confirmation.review_step_3', { defaultValue: 'Aid resources are coordinated to affected areas.' })}</span>
            </li>
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {!isQueued && typeof navigator.share === 'function' && (
          <button
            onClick={share}
            className="flex items-center justify-center gap-2 rounded-xl bg-un-blue px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-600"
          >
            <Share2 size={16} /> {t('confirmation.share_report', { defaultValue: 'Share Report' })}
          </button>
        )}

        <Link
          to="/submit"
          className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-6 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {t('confirmation.btn_submit_another')}
        </Link>

        <Link
          to="/"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-600"
        >
          <MapPin size={14} /> {t('confirmation.btn_view_map')}
        </Link>
      </div>

      <p className="mt-8 text-xs text-gray-300">
        {t('confirmation.footer_note', {
          defaultValue: 'UNDP Crisis Reporter | Community-powered damage assessment',
        })}
      </p>
    </div>
  );
}

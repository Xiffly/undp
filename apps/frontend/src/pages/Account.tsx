import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Save, Shield, Smartphone, UserCircle2, Upload, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type AdminUserIdentitySummary } from '../api/client';
import ContributorSummaryCard from '../components/ContributorSummaryCard';
import { usePublicAuthStore } from '../store/publicAuth';
import type { PublicUserProfile } from '../types';
import { getBadgeLabel } from '../utils/contributorReputation';

type VerificationStartResponse = {
  nonce?: string | null;
  instructions?: string | null;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function Account() {
  const { t } = useTranslation();
  const setUser = usePublicAuthStore((state) => state.setUser);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [identity, setIdentity] = useState<AdminUserIdentitySummary | null>(null);
  const [verificationNonce, setVerificationNonce] = useState('');
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address_line: '',
    country_code: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const me = await api.getMe();
    setProfile(me);
    setForm({
      name: me.name || '',
      phone: me.phone || '',
      address_line: me.address_line || '',
      country_code: me.country_code || '',
    });
    setUser({ id: me.id, name: me.name, email: me.email, role: me.role, profile_photo_url: me.profile_photo_url });
    try {
      const identityState = await api.getMyIdentity();
      setIdentity(identityState);
      setForm((current) => ({
        ...current,
        phone: identityState?.phone || me.phone || '',
      }));
    } catch (err: unknown) {
      setIdentity(null);
      console.error('Failed to load identity summary', err);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      load().catch((err: unknown) => setError(getApiErrorMessage(err, t('account.load_error'))));
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [load, t]);

  const showSuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(''), 3000);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api.updateMe(form);
      setProfile(response.user);
      const identityState = await api.getMyIdentity();
      setIdentity(identityState);
      setUser((response.user as PublicUserProfile | null) ? { id: response.user.id, name: response.user.name, email: response.user.email, role: response.user.role, profile_photo_url: response.user.profile_photo_url } : null);
      showSuccess(t('account.save_success'));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('account.save_error')));
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const response = await api.uploadMyAvatar(file);
      setProfile(response.user);
      setUser({ id: response.user.id, name: response.user.name, email: response.user.email, role: response.user.role, profile_photo_url: response.user.profile_photo_url });
      showSuccess(t('account.avatar_upload_success'));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('account.avatar_upload_error')));
    } finally {
      setUploadingAvatar(false);
      event.target.value = '';
    }
  };

  const removeAvatar = async () => {
    setRemovingAvatar(true);
    setError('');
    try {
      const response = await api.deleteMyAvatar();
      setProfile(response.user);
      setUser({ id: response.user.id, name: response.user.name, email: response.user.email, role: response.user.role, profile_photo_url: response.user.profile_photo_url });
      showSuccess(t('account.avatar_remove_success'));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('account.avatar_remove_error')));
    } finally {
      setRemovingAvatar(false);
    }
  };

  const startVerification = async () => {
    setVerifying(true);
    setError('');
    try {
      const response = await api.startPhoneVerification(form.phone) as VerificationStartResponse;
      setVerificationNonce(response.nonce || '');
      setIdentity(await api.getMyIdentity());
      showSuccess(response.instructions || t('account.verification_started'));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('account.verification_start_error')));
    } finally {
      setVerifying(false);
    }
  };

  const completeVerification = async () => {
    setCompleting(true);
    setError('');
    try {
      await api.completePhoneVerification(verificationNonce || identity?.verification_nonce);
      setIdentity(await api.getMyIdentity());
      showSuccess(t('account.verification_complete_success'));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('account.verification_complete_error')));
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gray-50">
        <Loader2 size={24} className="animate-spin text-un-blue" />
      </div>
    );
  }

  const contributorBadge = identity?.contributor?.primary_badge
    ? t(`contributor.badges.${identity.contributor.primary_badge}`, {
        defaultValue: getBadgeLabel(identity.contributor.primary_badge, t('confirmation.badge_default', { defaultValue: 'Contributor' })),
      })
    : t('confirmation.badge_default', { defaultValue: 'Contributor' });
  const totalReports = Number(identity?.contributor?.reports_submitted || 0);
  const verifiedPhone = identity?.verified_phone || null;
  const pendingPhone = identity?.pending_phone || null;
  const verificationDisplayPhone = pendingPhone || identity?.phone || form.phone || '';
  const verifyButtonLabel = identity?.phone_verified && form.phone && form.phone !== verifiedPhone
    ? t('account.change_verified_phone', { defaultValue: 'Verify New Phone' })
    : t('account.verify_with_whatsapp');

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('account.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('account.subtitle')}
          </p>
        </div>

        {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        {success && <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-600">{success}</div>}

        <form onSubmit={saveProfile} className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <UserCircle2 size={18} className="text-un-blue" />
            <h2 className="font-semibold text-gray-800">{t('account.profile_section')}</h2>
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-4">
            {profile?.profile_photo_url ? (
              <img src={profile.profile_photo_url} alt="" className="h-20 w-20 rounded-full object-cover border border-gray-200" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                <UserCircle2 size={28} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-un-blue px-4 py-2 text-sm font-medium text-un-blue hover:bg-un-light">
                <Upload size={14} />
                {uploadingAvatar ? t('account.avatar_uploading') : t('account.avatar_upload')}
                <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} disabled={uploadingAvatar} />
              </label>
              {profile?.profile_photo_url && (
                <button type="button" onClick={removeAvatar} disabled={removingAvatar} className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60">
                  <Trash2 size={14} />
                  {removingAvatar ? t('account.avatar_removing') : t('account.avatar_remove')}
                </button>
              )}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.name')}</label>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.email')}</label>
              <input disabled value={profile?.email || ''} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.phone')}</label>
              <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.country')}</label>
              <input value={form.country_code} onChange={(event) => setForm((current) => ({ ...current, country_code: event.target.value.toUpperCase().slice(0, 2) }))} placeholder={t('account.country_placeholder')} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.address')}</label>
              <input value={form.address_line} onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <div className="space-y-1 text-xs text-gray-400">
              <p>{t('account.role_label')}: {profile?.role || 'public_user'}</p>
              <p>{t('contributor.badge_label', { defaultValue: 'Badge' })}: {contributorBadge}</p>
              <p>{t('account.total_reports', { defaultValue: 'Total reports' })}: {totalReports}</p>
            </div>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2.5 font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? t('account.saving') : t('account.save')}
            </button>
          </div>
        </form>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Smartphone size={18} className="text-un-blue" />
            <h2 className="font-semibold text-gray-800">{t('account.whatsapp_title')}</h2>
          </div>
          <p className="text-sm text-gray-600">
            {t('account.whatsapp_subtitle')}
          </p>
          <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
            <p><span className="font-semibold">{t('account.phone')}:</span> {verifiedPhone || pendingPhone || t('account.not_set')}</p>
            <p className="mt-1"><span className="font-semibold">{t('account.verification_status')}:</span> {identity?.phone_verified ? t('account.verified') : identity?.verification_pending ? t('account.pending') : t('account.unverified')}</p>
            {verifiedPhone && (
              <p className="mt-1"><span className="font-semibold">{t('account.verified_phone', { defaultValue: 'Verified phone' })}:</span> {verifiedPhone}</p>
            )}
            {pendingPhone && (
              <p className="mt-1"><span className="font-semibold">{t('account.pending_phone', { defaultValue: 'Pending phone' })}:</span> {pendingPhone}</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={startVerification} disabled={verifying || !form.phone} className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">
              {verifying ? t('account.starting') : verifyButtonLabel}
            </button>
            <Link to="/queue" className="rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50">
              {t('queue.open_queue')}
            </Link>
          </div>
          {(identity?.verification_pending || verificationNonce) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800">
                {t('account.verification_instructions', { code: verificationNonce || identity?.verification_nonce, phone: verificationDisplayPhone })}
              </p>
              {verifiedPhone && pendingPhone && verifiedPhone !== pendingPhone && (
                <p className="mt-2 text-xs text-amber-700">
                  {t('account.pending_phone_note', {
                    defaultValue: 'Your current verified phone stays active until the new number is confirmed.',
                  })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={verificationNonce}
                  onChange={(event) => setVerificationNonce(event.target.value.toUpperCase())}
                  placeholder={t('account.enter_code')}
                  className="rounded-xl border border-amber-200 px-3 py-2 text-sm"
                />
                <button type="button" onClick={completeVerification} disabled={completing || !(verificationNonce || identity?.verification_nonce)} className="flex items-center gap-2 rounded-xl bg-un-dark px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60">
                  {completing ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                  {completing ? t('account.verifying') : t('account.complete_verification')}
                </button>
              </div>
            </div>
          )}
        </div>

        <ContributorSummaryCard
          contributor={identity?.contributor}
          title={t('account.contributor_title')}
          pendingMessage={t('account.contributor_note')}
        />
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Key, Shield, UserCircle } from 'lucide-react';
import { api } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getBadgeLabel } from '../../utils/contributorReputation';

type MeResponse = {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: string;
  phone?: string;
};

type IdentityResponse = {
  phone?: string | null;
  verified_phone?: string | null;
  pending_phone?: string | null;
  phone_verified?: boolean;
  linked_contributor_key?: string | null;
  verification_pending?: boolean;
  verification_nonce?: string | null;
  verification_expires_at?: string | null;
  contributor?: {
    primary_badge?: string;
    level_code?: string;
    trust_score?: number;
    points_total?: number;
  } | null;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

export default function Settings() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  const [completingPhone, setCompletingPhone] = useState(false);
  const [verificationNonce, setVerificationNonce] = useState('');
  const [profileForm, setProfileForm] = useState({
    name: '',
    organization: '',
    phone: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const user = await api.getMe('admin');
        const identityState = await api.getMyIdentity('admin');
        setMe(user);
        setIdentity(identityState);
        setProfileForm({
          name: user.name || '',
          organization: user.organization || '',
          phone: identityState?.phone || user.phone || '',
        });
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, t('admin.settings.error_load', { defaultValue: 'Failed to load account settings.' })));
      } finally {
        setLoading(false);
      }
    };
    const loadId = scheduleTask(() => {
      load().catch(() => {});
    });
    return () => window.clearTimeout(loadId);
  }, [t]);

  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(''), 3000);
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    try {
      const response = await api.updateMe(profileForm, 'admin');
      setMe((current) => current ? { ...current, ...response.user } : response.user);
      setIdentity(await api.getMyIdentity('admin'));
      showSuccess(t('admin.settings.success_profile', { defaultValue: 'Profile updated.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.settings.error_profile', { defaultValue: 'Failed to update profile.' })));
    } finally {
      setSavingProfile(false);
    }
  };

  const startVerification = async () => {
    setVerifyingPhone(true);
    setError('');
    try {
      const response = await api.startPhoneVerification(profileForm.phone, 'admin');
      setIdentity(await api.getMyIdentity('admin'));
      setVerificationNonce(response.nonce || '');
      showSuccess(response.instructions || t('admin.settings.verification_started', { defaultValue: 'Verification started.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.settings.verification_start_error', { defaultValue: 'Failed to start phone verification.' })));
    } finally {
      setVerifyingPhone(false);
    }
  };

  const completeVerification = async () => {
    setCompletingPhone(true);
    setError('');
    try {
      await api.completePhoneVerification(verificationNonce, 'admin');
      setIdentity(await api.getMyIdentity('admin'));
      showSuccess(t('admin.settings.verification_complete_success', { defaultValue: 'Phone verified and linked to contributor profile.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.settings.verification_complete_error', { defaultValue: 'Failed to complete phone verification.' })));
    } finally {
      setCompletingPhone(false);
    }
  };

  const removeVerification = async () => {
    setError('');
    try {
      await api.deletePhoneVerification('admin');
      setIdentity(await api.getMyIdentity('admin'));
      showSuccess(t('admin.settings.verification_remove_success', { defaultValue: 'Phone verification removed.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.settings.verification_remove_error', { defaultValue: 'Failed to remove verification.' })));
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError(t('admin.settings.error_password_mismatch', { defaultValue: 'New password and confirmation do not match.' }));
      return;
    }
    setSavingPassword(true);
    try {
      await api.updateMe({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }, 'admin');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showSuccess(t('admin.settings.success_password', { defaultValue: 'Password updated.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.settings.error_password', { defaultValue: 'Failed to update password.' })));
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return <LoadingSpinner text={t('admin.settings.loading', { defaultValue: 'Loading settings...' })} />;
  }

  const verifiedPhone = identity?.verified_phone || null;
  const pendingPhone = identity?.pending_phone || null;
  const verificationDisplayPhone = pendingPhone || identity?.phone || profileForm.phone;
  const verifyButtonLabel = identity?.phone_verified && profileForm.phone && profileForm.phone !== verifiedPhone
    ? t('admin.settings.verify_new_phone', { defaultValue: 'Verify New Phone' })
    : t('account.verify_with_whatsapp', { defaultValue: 'Verify with WhatsApp' });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.settings.title', { defaultValue: 'Settings' })}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('admin.settings.subtitle', { defaultValue: 'Manage your admin account, contact details, and linked identity.' })}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <form onSubmit={saveProfile} className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <UserCircle size={18} className="text-un-blue" />
          <h2 className="font-semibold text-gray-800">{t('admin.settings.profile_title', { defaultValue: 'Profile' })}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.settings.name', { defaultValue: 'Name' })}</label>
            <input
              type="text"
              value={profileForm.name}
              onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.settings.email', { defaultValue: 'Email' })}</label>
            <input
              type="email"
              value={me?.email || ''}
              disabled
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.settings.organization', { defaultValue: 'Organization' })}</label>
            <input
              type="text"
              value={profileForm.organization}
              onChange={(event) => setProfileForm((current) => ({ ...current, organization: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.settings.phone', { defaultValue: 'Phone' })}</label>
            <input
              type="text"
              value={profileForm.phone}
              onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-400">
            {t('admin.settings.role', { defaultValue: 'Role' })}: {me?.role || 'admin'}
          </p>
          <button
            type="submit"
            disabled={savingProfile}
            className="flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
          >
            <Save size={16} />
            {savingProfile
              ? t('admin.common.saving', { defaultValue: 'Saving...' })
              : t('admin.settings.save_profile', { defaultValue: 'Save Profile' })}
          </button>
        </div>
      </form>

      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-un-blue" />
          <h2 className="font-semibold text-gray-800">{t('admin.settings.whatsapp_identity_title', { defaultValue: 'WhatsApp Identity' })}</h2>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">
          <p><span className="font-semibold">{t('account.phone', { defaultValue: 'Phone' })}:</span> {verifiedPhone || pendingPhone || t('account.not_set', { defaultValue: 'Not set' })}</p>
          <p className="mt-1"><span className="font-semibold">{t('account.verification_status', { defaultValue: 'Verification' })}:</span> {identity?.phone_verified ? t('account.verified', { defaultValue: 'Verified' }) : identity?.verification_pending ? t('account.pending', { defaultValue: 'Pending' }) : t('account.unverified', { defaultValue: 'Unverified' })}</p>
          {verifiedPhone && (
            <p className="mt-1"><span className="font-semibold">{t('account.verified_phone', { defaultValue: 'Verified phone' })}:</span> {verifiedPhone}</p>
          )}
          {pendingPhone && (
            <p className="mt-1"><span className="font-semibold">{t('account.pending_phone', { defaultValue: 'Pending phone' })}:</span> {pendingPhone}</p>
          )}
          <p className="mt-1"><span className="font-semibold">{t('admin.settings.linked_contributor', { defaultValue: 'Linked contributor' })}:</span> {identity?.linked_contributor_key || t('admin.settings.not_linked', { defaultValue: 'Not linked' })}</p>
          {identity?.contributor && (
            <p className="mt-1">
              <span className="font-semibold">{t('account.contributor_title', { defaultValue: 'Contributor standing' })}:</span>{' '}
              {t('admin.settings.contributor_standing_summary', {
                badge: identity.contributor.primary_badge
                  ? t(`contributor.badges.${identity.contributor.primary_badge}`, {
                      defaultValue: getBadgeLabel(identity.contributor.primary_badge, t('confirmation.badge_default', { defaultValue: 'Contributor' })),
                    })
                  : t('confirmation.badge_default', { defaultValue: 'Contributor' }),
                trust: identity.contributor.trust_score || 0,
                points: identity.contributor.points_total || 0,
                defaultValue: '{{badge}} | trust {{trust}}/100 | {{points}} pts',
              })}
            </p>
          )}
        </div>

        <p className="text-xs text-gray-500">
          {t('admin.settings.whatsapp_identity_note', {
            defaultValue: 'Verified WhatsApp activity is merged into the same contributor profile as your website account when the phone ownership check succeeds.',
          })}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startVerification}
            disabled={verifyingPhone || !profileForm.phone}
            className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {verifyingPhone
              ? t('account.starting', { defaultValue: 'Starting...' })
              : verifyButtonLabel}
          </button>
          {identity?.phone_verified && (
            <button type="button" onClick={removeVerification} className="rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50">
              {t('admin.settings.remove_verification', { defaultValue: 'Remove Verification' })}
            </button>
          )}
        </div>

        {(identity?.verification_pending || verificationNonce) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              {t('account.verification_instructions', {
                code: verificationNonce || identity?.verification_nonce,
                phone: verificationDisplayPhone,
                defaultValue: 'Send code {{code}} to the WhatsApp bot from {{phone}}.',
              })}
            </p>
            {verifiedPhone && pendingPhone && verifiedPhone !== pendingPhone && (
              <p className="mt-2 text-xs text-amber-700">
                {t('account.pending_phone_note', {
                  defaultValue: 'Your current verified phone stays active until the new number is confirmed.',
                })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={verificationNonce}
                onChange={(event) => setVerificationNonce(event.target.value.toUpperCase())}
                placeholder={t('account.enter_code', { defaultValue: 'Enter code' })}
                className="rounded-xl border border-amber-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={completeVerification}
                disabled={completingPhone || !verificationNonce}
                className="rounded-xl bg-un-dark px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-60"
              >
                {completingPhone
                  ? t('account.verifying', { defaultValue: 'Verifying...' })
                  : t('account.complete_verification', { defaultValue: 'Complete Verification' })}
              </button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={savePassword} className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Key size={18} className="text-un-blue" />
          <h2 className="font-semibold text-gray-800">{t('admin.settings.password_title', { defaultValue: 'Password' })}</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.settings.current_password', { defaultValue: 'Current password' })}
            </label>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.settings.new_password', { defaultValue: 'New password' })}
            </label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.settings.confirm_password', { defaultValue: 'Confirm new password' })}
            </label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-400">
            {t('admin.settings.password_hint', { defaultValue: 'Passwords must be at least 10 characters.' })}
          </p>
          <button
            type="submit"
            disabled={savingPassword}
            className="flex items-center gap-2 rounded-xl bg-un-dark px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-900 disabled:opacity-60"
          >
            <Shield size={16} />
            {savingPassword
              ? t('admin.settings.updating_password', { defaultValue: 'Updating...' })
              : t('admin.settings.update_password', { defaultValue: 'Update Password' })}
          </button>
        </div>
      </form>
    </div>
  );
}

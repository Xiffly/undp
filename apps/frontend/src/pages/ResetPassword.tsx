import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      setError(t('auth_public.reset_invalid_token', { defaultValue: 'Reset link is invalid or has expired.' }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth_public.reset_password_mismatch', { defaultValue: 'Passwords do not match.' }));
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(t('auth_public.reset_success', { defaultValue: 'Password updated successfully. You can now sign in.' }));
      window.setTimeout(() => navigate('/login'), 1200);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('auth_public.reset_invalid_token', { defaultValue: 'Reset link is invalid or has expired.' })));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-un-blue/10 text-un-blue">
            <KeyRound size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('auth_public.reset_password_title', { defaultValue: 'Reset Password' })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('auth_public.reset_password_subtitle', { defaultValue: 'Choose a new password for your public account.' })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('auth_public.password', { defaultValue: 'Password' })}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {t('auth_public.password_hint', { defaultValue: 'Passwords must be at least 10 characters.' })}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('auth_public.confirm_password', { defaultValue: 'Confirm Password' })}
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <button
            type="submit"
            disabled={loading || !password || !confirmPassword || !token}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading
              ? t('auth_public.resetting_password', { defaultValue: 'Updating password...' })
              : t('auth_public.reset_password_action', { defaultValue: 'Update Password' })}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          <Link to="/login" className="font-semibold text-un-blue hover:underline">
            {t('auth_public.back_to_login', { defaultValue: 'Back to Sign In' })}
          </Link>
        </p>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, UserCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useConsent } from '../consent/useConsent';
import { useAuthStore } from '../store/auth';
import { usePublicAuthStore } from '../store/publicAuth';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const adminLogin = useAuthStore((state) => state.login);
  const login = usePublicAuthStore((state) => state.login);
  const { hasRequiredConsent } = useConsent();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.userLogin(email.trim().toLowerCase(), password);
      if (result.user.role === 'admin' || result.user.role === 'team_lead' || result.user.role === 'field_officer') {
        adminLogin();
        navigate('/admin');
      } else {
        login(result.token, result.user);
        navigate('/account');
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('auth_public.login_error', { defaultValue: 'Unable to sign in with those credentials.' })));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-un-blue/10 text-un-blue">
            <UserCircle2 size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('auth_public.login_title', { defaultValue: 'Account Login' })}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!hasRequiredConsent && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {t('consent.blocked_message', { defaultValue: 'Choose a privacy option to continue with account and reporting features.' })}
            </p>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth_public.email', { defaultValue: 'Email' })}</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth_public.password', { defaultValue: 'Password' })}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
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
            <div className="mt-2 text-right">
              <Link to="/forgot-password" className="text-sm font-medium text-un-blue hover:underline">
                {t('auth_public.forgot_password', { defaultValue: 'Forgot password?' })}
              </Link>
            </div>
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading || !email || !password || !hasRequiredConsent}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading
              ? t('auth_public.signing_in', { defaultValue: 'Signing in...' })
              : t('auth_public.sign_in', { defaultValue: 'Sign In' })}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          {t('auth_public.need_account', { defaultValue: 'Need an account?' })}{' '}
          <Link to="/signup" className="font-semibold text-un-blue hover:underline">
            {t('auth_public.sign_up', { defaultValue: 'Sign Up' })}
          </Link>
        </p>
      </div>
    </div>
  );
}

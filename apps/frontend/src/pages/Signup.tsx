import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useConsent } from '../consent/useConsent';
import { usePublicAuthStore } from '../store/publicAuth';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = usePublicAuthStore((state) => state.login);
  const { hasRequiredConsent } = useConsent();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    address_line: '',
    country_code: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.registerUser(form);
      login(result.token, result.user);
      navigate('/account');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('auth_public.signup_error', { defaultValue: 'Unable to create your account.' })));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-un-blue/10 text-un-blue">
            <UserPlus size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('auth_public.signup_title', { defaultValue: 'Create Public Account' })}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('auth_public.signup_subtitle', { defaultValue: 'Keep your local drafts visible, verify your phone, and track your reviewed contributor standing.' })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          {!hasRequiredConsent && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 md:col-span-2">
              {t('consent.blocked_message', { defaultValue: 'Choose a privacy option to continue with account and reporting features.' })}
            </p>
          )}
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth_public.full_name', { defaultValue: 'Full Name' })}</label>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth_public.email', { defaultValue: 'Email' })}</label>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('auth_public.password', { defaultValue: 'Password' })}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
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
            <p className="mt-1 text-xs text-gray-400">{t('auth_public.password_hint', { defaultValue: 'Passwords must be at least 10 characters.' })}</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.phone', { defaultValue: 'Phone' })}</label>
            <input
              type="text"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.country', { defaultValue: 'Country' })}</label>
            <input
              type="text"
              value={form.country_code}
              onChange={(event) => setForm((current) => ({ ...current, country_code: event.target.value.toUpperCase().slice(0, 2) }))}
              placeholder={t('account.country_placeholder', { defaultValue: 'e.g. IE' })}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('account.address', { defaultValue: 'Address' })}</label>
            <input
              type="text"
              value={form.address_line}
              onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 md:col-span-2">{error}</p>}

          <button
            type="submit"
            disabled={loading || !form.name || !form.email || !form.password || !hasRequiredConsent}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-60 md:col-span-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading
              ? t('auth_public.creating_account', { defaultValue: 'Creating account...' })
              : t('auth_public.create_account', { defaultValue: 'Create Account' })}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          {t('auth_public.have_account', { defaultValue: 'Already registered?' })}{' '}
          <Link to="/login" className="font-semibold text-un-blue hover:underline">
            {t('auth_public.sign_in', { defaultValue: 'Sign In' })}
          </Link>
        </p>
      </div>
    </div>
  );
}

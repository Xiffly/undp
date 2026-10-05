import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.forgotPassword(email.trim().toLowerCase());
      setSuccess(response.message || t('auth_public.reset_email_sent', { defaultValue: 'If an account exists for that email, a password reset link has been sent.' }));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('auth_public.reset_request_error', { defaultValue: 'Unable to request a password reset right now.' })));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-un-blue/10 text-un-blue">
            <Mail size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('auth_public.forgot_password_title', { defaultValue: 'Forgot Password' })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('auth_public.forgot_password_subtitle', { defaultValue: 'Enter your email and we will send you a password reset link.' })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('auth_public.email', { defaultValue: 'Email' })}
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <button
            type="submit"
            disabled={loading || !email}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading
              ? t('auth_public.sending_reset', { defaultValue: 'Sending reset link...' })
              : t('auth_public.send_reset', { defaultValue: 'Send Reset Link' })}
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

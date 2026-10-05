import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Loader2, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/auth';

export default function AdminLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await api.adminLogin(email.trim().toLowerCase(), password);
      login();
      navigate('/admin');
    } catch {
      setError(t('admin.login.invalid_credentials', { defaultValue: 'Invalid email or password.' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-un-dark to-un-blue flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-un-blue/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-un-blue" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.login.title', { defaultValue: 'Admin Panel' })}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('admin.login.subtitle', { defaultValue: 'UNDP Crisis Assessment Platform' })}</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.login.email', { defaultValue: 'Email' })}
            </label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('admin.login.email_placeholder', { defaultValue: 'admin@example.org' })}
              autoComplete="username"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700 mb-1">
              {t('admin.login.password', { defaultValue: 'Password' })}
            </label>
            <div className="relative">
              <input id="admin-password" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder={t('admin.login.password_placeholder', { defaultValue: 'Enter admin password' })}
                autoComplete="current-password"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30" />
              <button type="button" onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <p className="text-red-500 text-sm mb-3 bg-red-50 p-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading || !email || !password}
            className="w-full bg-un-blue text-white py-3 rounded-xl font-semibold hover:bg-blue-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? t('admin.login.signing_in', { defaultValue: 'Signing in...' }) : t('admin.login.sign_in', { defaultValue: 'Sign In' })}
          </button>
        </form>
      </div>
    </div>
  );
}

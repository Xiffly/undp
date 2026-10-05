import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MapPin, Plus, Map, Shield, Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { useAuthStore } from '../store/auth';
import { usePublicAuthStore } from '../store/publicAuth';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = location.pathname.startsWith('/admin');
  const adminAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const publicLogout = usePublicAuthStore((s) => s.logout);
  const publicUser = usePublicAuthStore((s) => s.user);
  const publicAuthenticated = usePublicAuthStore((s) => s.isAuthenticated);
  const { queueSize } = useOfflineQueue();
  const publicAuthMode = !isAdmin
    ? (adminAuthenticated && publicAuthenticated ? 'dual' : adminAuthenticated ? 'admin' : publicAuthenticated ? 'public' : 'guest')
    : 'admin-panel';
  const showQueueLink = queueSize > 0;

  const handleLogout = async () => {
    try { await logout(); navigate('/admin/login'); }
    catch { window.alert(t('nav.logout_failed', { defaultValue: 'Logout failed; please try again.' })); }
  };

  const handlePublicLogout = () => {
    publicLogout();
    navigate('/');
  };

  const handlePublicAdminLogout = async () => {
    try { await logout(); navigate('/'); }
    catch { window.alert(t('nav.logout_failed', { defaultValue: 'Logout failed; please try again.' })); }
  };

  const navLinks = isAdmin ? [
    { to: '/admin', label: t('nav.dashboard', { defaultValue: 'Dashboard' }), exact: true },
    { to: '/admin/map', label: t('nav.map') },
    { to: '/admin/reports', label: t('nav.reports', { defaultValue: 'Reports' }) },
    { to: '/admin/users', label: t('nav.users', { defaultValue: 'Users' }) },
    { to: '/admin/export', label: t('nav.export', { defaultValue: 'Export' }) },
    { to: '/admin/form-builder', label: t('nav.form_builder', { defaultValue: 'Form Builder' }) },
    { to: '/admin/translations', label: t('nav.translations', { defaultValue: 'Translations' }) },
    { to: '/admin/content', label: t('nav.content', { defaultValue: 'Content' }) },
    { to: '/admin/ai', label: t('nav.ai', { defaultValue: 'AI' }) },
    { to: '/admin/settings', label: t('nav.settings', { defaultValue: 'Settings' }) },
  ] : [
    { to: '/', label: t('nav.home'), exact: true },
    { to: '/submit', label: t('nav.submit') },
    { to: '/map', label: t('nav.map') },
    { to: '/news', label: t('nav.news', { defaultValue: 'News' }) },
    ...(showQueueLink ? [{ to: '/queue', label: t('nav.my_queue', { defaultValue: 'My Queue' }) }] : []),
    ...(publicAuthenticated ? [{ to: '/account', label: t('nav.my_account', { defaultValue: 'My Account' }) }] : []),
  ];

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to);

  const brandLabel = isAdmin
    ? t('nav.brand_admin', { defaultValue: 'UNDP Crisis Admin' })
    : t('nav.brand_public', { defaultValue: 'UNDP Crisis Reporter' });

  return (
    <>
      <header className="bg-un-dark text-white shadow-lg sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity flex-shrink-0 min-w-0">
            <div className="w-8 h-8 bg-un-blue rounded-full flex items-center justify-center flex-shrink-0">
              <MapPin size={16} />
            </div>
            <span className="font-bold text-sm md:text-base whitespace-nowrap">{brandLabel}</span>
            {isAdmin && <span className="bg-un-blue text-white text-xs px-2 py-0.5 rounded-full">{t('nav.admin_short', { defaultValue: 'Admin' })}</span>}
          </Link>

          <div className="hidden md:flex items-center gap-3 flex-1 min-w-0">
            <nav className="flex items-center gap-1 min-w-0 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                    isActive(link.to, link.exact) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              {!isAdmin && (
                <Link to="/submit" className="ml-2 bg-un-blue hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors flex-shrink-0">
                  <Plus size={14} /> {t('nav.submit')}
                </Link>
              )}
            </nav>
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
              {isAdmin && (
                <button
                  onClick={handleLogout}
                  className="text-blue-200 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 whitespace-nowrap"
                >
                  {t('nav.logout', { defaultValue: 'Logout' })}
                </button>
              )}
              {publicAuthMode === 'admin' && (
                <>
                  <Link
                    to="/admin"
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive('/admin', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    {t('nav.dashboard', { defaultValue: 'Dashboard' })}
                  </Link>
                  <div className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white whitespace-nowrap">
                    <Shield size={14} />
                    <span>{t('nav.admin_profile', { defaultValue: 'Admin Profile' })}</span>
                  </div>
                  <button
                    onClick={handlePublicAdminLogout}
                    className="text-blue-200 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 whitespace-nowrap"
                  >
                    {t('nav.logout', { defaultValue: 'Logout' })}
                  </button>
                </>
              )}
              {publicAuthMode === 'dual' && (
                <>
                  <Link
                    to="/account"
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive('/account', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    {t('nav.my_account', { defaultValue: 'My Account' })}
                  </Link>
                  <Link
                    to="/admin"
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive('/admin', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                    }`}
                  >
                    {t('nav.dashboard', { defaultValue: 'Dashboard' })}
                  </Link>
                  <button
                    onClick={handlePublicLogout}
                    className="text-blue-200 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 whitespace-nowrap"
                  >
                    {t('nav.logout_public', { defaultValue: 'Logout Public' })}
                  </button>
                  <button
                    onClick={handlePublicAdminLogout}
                    className="text-blue-200 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 whitespace-nowrap"
                  >
                    {t('nav.logout_admin', { defaultValue: 'Logout Admin' })}
                  </button>
                </>
              )}
              {publicAuthMode === 'public' && (
                <button
                  onClick={handlePublicLogout}
                  className="text-blue-200 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 whitespace-nowrap"
                >
                  {t('nav.logout', { defaultValue: 'Logout' })}
                </button>
              )}
              {publicAuthMode === 'guest' && (
                <>
                  <Link to="/login" className="text-blue-100 hover:bg-white/10 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap">
                    {t('auth_public.sign_in', { defaultValue: 'Sign In' })}
                  </Link>
                  <Link to="/signup" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 whitespace-nowrap">
                    {t('auth_public.sign_up', { defaultValue: 'Sign Up' })}
                  </Link>
                </>
              )}
              <LanguageSwitcher />
            </div>
          </div>

          <div className="md:hidden flex items-center gap-1 ml-auto">
            <LanguageSwitcher compact />
            <button className="p-2" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-un-dark border-t border-white/10 px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                  isActive(link.to, link.exact) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                }`}
              >
                {link.label}
              </Link>
            ))}
            {publicAuthMode === 'guest' && (
              <>
                <Link
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-blue-100 hover:bg-white/10"
                >
                  {t('auth_public.sign_in', { defaultValue: 'Sign In' })}
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-blue-100 hover:bg-white/10"
                >
                  {t('auth_public.sign_up', { defaultValue: 'Sign Up' })}
                </Link>
              </>
            )}
            {publicAuthMode === 'public' && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  handlePublicLogout();
                }}
                className="block w-full px-3 py-2 rounded-lg text-left text-sm font-medium text-blue-100 hover:bg-white/10"
              >
                {t('nav.logout', { defaultValue: 'Logout' })} {publicUser?.name ? `(${publicUser.name})` : ''}
              </button>
            )}
            {publicAuthMode === 'dual' && (
              <>
                <Link
                  to="/account"
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    isActive('/account', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  {t('nav.my_account', { defaultValue: 'My Account' })}
                </Link>
                <Link
                  to="/admin"
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    isActive('/admin', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  {t('nav.dashboard', { defaultValue: 'Dashboard' })}
                </Link>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handlePublicLogout();
                  }}
                  className="block w-full px-3 py-2 rounded-lg text-left text-sm font-medium text-blue-100 hover:bg-white/10"
                >
                  {t('nav.logout_public', { defaultValue: 'Logout Public' })} {publicUser?.name ? `(${publicUser.name})` : ''}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handlePublicAdminLogout();
                  }}
                  className="block w-full px-3 py-2 rounded-lg text-left text-sm font-medium text-blue-100 hover:bg-white/10"
                >
                  {t('nav.logout_admin', { defaultValue: 'Logout Admin' })}
                </button>
              </>
            )}
            {publicAuthMode === 'admin' && (
              <>
                <Link
                  to="/admin"
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-2 rounded-lg text-sm font-medium ${
                    isActive('/admin', true) ? 'bg-un-blue text-white' : 'text-blue-100 hover:bg-white/10'
                  }`}
                >
                  {t('nav.dashboard', { defaultValue: 'Dashboard' })}
                </Link>
                <div className="block px-3 py-2 rounded-lg text-sm font-medium text-blue-100">
                  {t('nav.admin_profile', { defaultValue: 'Admin Profile' })}
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handlePublicAdminLogout();
                  }}
                  className="block w-full px-3 py-2 rounded-lg text-left text-sm font-medium text-blue-100 hover:bg-white/10"
                >
                  {t('nav.logout', { defaultValue: 'Logout' })}
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {!isAdmin && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 bottom-nav">
          <div className="flex">
            <Link to="/" className={`flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${location.pathname === '/' ? 'text-un-blue' : 'text-gray-500'}`}>
              <MapPin size={20} />
              <span className="mt-0.5">{t('nav.home')}</span>
            </Link>
            <Link to="/submit" className={`flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${location.pathname === '/submit' ? 'text-un-blue' : 'text-gray-500'}`}>
              <Plus size={20} />
              <span className="mt-0.5">{t('nav.submit_short')}</span>
            </Link>
            <Link to="/map" className={`flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${location.pathname === '/map' ? 'text-un-blue' : 'text-gray-500'}`}>
              <Map size={20} />
              <span className="mt-0.5">{t('nav.map_short')}</span>
            </Link>
            <Link to="/admin" className={`flex-1 flex flex-col items-center py-2 text-xs font-medium transition-colors ${isAdmin ? 'text-un-blue' : 'text-gray-500'}`}>
              <Shield size={20} />
              <span className="mt-0.5">{t('nav.admin_short')}</span>
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}

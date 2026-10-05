import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function UsersAdmin() {
  const { t } = useTranslation();
  const tabs = [
    { to: '/admin/users/team', label: t('admin.users_admin.team_tab', { defaultValue: 'Team' }) },
    { to: '/admin/users/registered', label: t('admin.registered_users.title', { defaultValue: 'Users' }) },
    { to: '/admin/users/contributors', label: t('admin.contributors.title', { defaultValue: 'Contributors' }) },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.users_admin.title', { defaultValue: 'Users' })}</h1>
        <p className="text-sm text-gray-500">{t('admin.users_admin.subtitle', { defaultValue: 'Manage staff accounts and contributor profiles in one place.' })}</p>
      </div>
      <div className="mb-5 flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-un-blue text-white' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

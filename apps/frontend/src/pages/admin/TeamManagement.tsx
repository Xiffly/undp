import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, RefreshCw, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type AdminUserListItem } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';

type StaffRole = 'field_officer' | 'team_lead' | 'admin';

const ROLE_COLORS: Record<StaffRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
  team_lead: 'bg-blue-100 text-blue-700',
  field_officer: 'bg-green-100 text-green-700',
};
const ROLE_ORDER: StaffRole[] = ['admin', 'team_lead', 'field_officer'];

function timeAgo(t: (key: string, options?: Record<string, unknown>) => string, d?: string) {
  if (!d) return t('admin.registered_users.never', { defaultValue: 'Never' });
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return t('admin.registered_users.just_now', { defaultValue: 'Just now' });
  if (s < 3600) return t('admin.registered_users.minutes_ago', { defaultValue: '{{count}}m ago', count: Math.floor(s / 60) });
  if (s < 86400) return t('admin.registered_users.hours_ago', { defaultValue: '{{count}}h ago', count: Math.floor(s / 3600) });
  return t('admin.registered_users.days_ago', { defaultValue: '{{count}}d ago', count: Math.floor(s / 86400) });
}

function isActiveFlag(value: boolean | number | undefined) {
  return value === true || value === 1;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

export default function TeamManagement() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [meRole, setMeRole] = useState<string>('team_lead');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'field_officer' as StaffRole,
    organization: '',
    phone: '',
  });

  const isAdmin = meRole === 'admin';
  const roleLabels: Record<StaffRole, string> = {
    admin: t('admin.team_management.role_admin', { defaultValue: 'Admin' }),
    team_lead: t('admin.team_management.role_team_lead', { defaultValue: 'Team Lead' }),
    field_officer: t('admin.team_management.role_field_officer', { defaultValue: 'Field Officer' }),
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userResp, meResp] = await Promise.all([api.getUsers({ scope: 'staff' }), api.getMe('admin')]);
      setUsers(userResp.users || []);
      setMeRole(meResp.role || 'team_lead');
    } catch (err: unknown) {
      setUsers([]);
      setError(getApiErrorMessage(err, t('admin.team_management.load_failed', { defaultValue: 'Failed to load staff users.' })));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadId = window.setTimeout(() => {
      fetchUsers().catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadId);
  }, [fetchUsers]);

  const activeUsers = useMemo(
    () => users.filter((user) => isActiveFlag(user.active)).length,
    [users]
  );

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name || !form.email || !form.password) {
      setError(t('admin.team_management.required_fields', { defaultValue: 'Name, email, and password are required.' }));
      return;
    }
    try {
      await api.createStaffUser(form as Record<string, string>);
      setSuccess(t('admin.team_management.registered_success', { defaultValue: '{{name}} registered successfully.', name: form.name }));
      setForm({ name: '', email: '', password: '', role: 'field_officer', organization: '', phone: '' });
      setShowForm(false);
      await fetchUsers();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('admin.team_management.registration_failed', { defaultValue: 'Registration failed.' })));
    }
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('admin.team_management.title', { defaultValue: 'Team' })}</h2>
          <p className="text-sm text-gray-500">{t('admin.team_management.active_staff_users', { defaultValue: '{{count}} active staff users', count: activeUsers })}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchUsers()} className="rounded-xl border border-gray-200 p-2 hover:bg-gray-50">
            <RefreshCw size={16} />
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-xl bg-un-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              <UserPlus size={16} /> {t('admin.team_management.add_member', { defaultValue: 'Add Member' })}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{success}</div>}

      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <div className="flex flex-wrap gap-4">
          {ROLE_ORDER.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}>{roleLabels[role]}</span>
              <span className="text-xs text-gray-500">
                {role === 'admin'
                  ? t('admin.team_management.role_admin_desc', { defaultValue: 'Full access' })
                  : role === 'team_lead'
                    ? t('admin.team_management.role_team_lead_desc', { defaultValue: 'Can manage operations and review data' })
                    : t('admin.team_management.role_field_officer_desc', { defaultValue: 'Can submit and review assigned workflows' })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text={t('admin.team_management.loading', { defaultValue: 'Loading team...' })} />
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div key={user.id} className="rounded-xl border border-gray-100 p-4 transition hover:border-gray-200 hover:bg-gray-50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role as StaffRole] || ROLE_COLORS.field_officer}`}>
                      {roleLabels[user.role as StaffRole] || user.role}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isActiveFlag(user.active) ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {isActiveFlag(user.active)
                        ? t('admin.team_management.status_active', { defaultValue: 'Active' })
                        : t('admin.team_management.status_inactive', { defaultValue: 'Inactive' })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{user.email}</p>
                  {user.phone && <p className="text-xs text-gray-400">{user.phone}</p>}
                </div>
                <div className="grid gap-2 text-sm sm:min-w-[260px] sm:grid-cols-2">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">{t('admin.settings.organization', { defaultValue: 'Organization' })}</p>
                    <p className="font-semibold text-gray-900">{user.organization || t('account.not_set', { defaultValue: 'Not set' })}</p>
                  </div>
                  <div className="rounded-xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-400">{t('admin.registered_users.last_login', { defaultValue: 'Last Login' })}</p>
                    <p className="font-semibold text-gray-900">{timeAgo(t, user.last_login)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!users.length && (
            <div className="py-8 text-center text-sm text-gray-400">
              <Users size={24} className="mx-auto mb-2 opacity-40" />
              {t('admin.team_management.no_members', { defaultValue: 'No team members yet.' })}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-800">{t('admin.team_management.add_member', { defaultValue: 'Add Member' })}</h3>
              <p className="text-sm text-gray-500">{t('admin.team_management.modal_subtitle', { defaultValue: 'Create a new staff user for admin operations.' })}</p>
            </div>
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{t('auth_public.full_name', { defaultValue: 'Full Name' })} *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.settings.role', { defaultValue: 'Role' })} *</label>
                  <select
                    value={form.role}
                    onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as StaffRole }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  >
                    <option value="field_officer">{t('admin.team_management.role_field_officer', { defaultValue: 'Field Officer' })}</option>
                    <option value="team_lead">{t('admin.team_management.role_team_lead', { defaultValue: 'Team Lead' })}</option>
                    <option value="admin">{t('admin.team_management.role_admin', { defaultValue: 'Admin' })}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">{t('auth_public.email', { defaultValue: 'Email' })} *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">{t('auth_public.password', { defaultValue: 'Password' })} *</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                  <button type="button" onClick={() => setShowPass((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.settings.organization', { defaultValue: 'Organization' })}</label>
                  <input
                    type="text"
                    value={form.organization}
                    onChange={(event) => setForm((current) => ({ ...current, organization: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">{t('admin.settings.phone', { defaultValue: 'Phone' })}</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  {t('admin.common.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button type="submit" className="flex-1 rounded-xl bg-un-blue px-4 py-2 text-sm font-medium text-white hover:bg-blue-600">
                  {t('admin.team_management.register', { defaultValue: 'Register' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

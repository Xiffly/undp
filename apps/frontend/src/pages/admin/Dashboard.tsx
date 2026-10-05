import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { FileText, Clock, CheckCircle, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { Stats, Report } from '../../types';
import DamageBadge from '../../components/DamageBadge';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import { formatRelativeTime } from '../../utils/relativeTime';

function StatCard({ icon: Icon, value, label, color }: { icon: LucideIcon; value: number | string; label: string; color: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4">
      <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center flex-shrink-0`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const reviewLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

  useEffect(() => {
    const fetch = async () => {
      try {
        const [s, r] = await Promise.all([api.getStats(), api.getAdminReports({ limit: '10', offset: '0' })]);
        setStats(s);
        setRecent(r.reports);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [reviewLanguage]);

  if (loading) return <LoadingSpinner text={t('admin.dashboard.loading', { defaultValue: 'Loading dashboard...' })} />;
  if (!stats) return <div className="p-8 text-center text-gray-500">{t('admin.dashboard.load_failed', { defaultValue: 'Failed to load stats' })}</div>;

  const pieData = [
    { name: t('map.filter_destroyed', { defaultValue: 'Destroyed' }), value: stats.destroyed, color: '#ef4135' },
    { name: t('map.filter_partial', { defaultValue: 'Partial' }), value: stats.partial, color: '#f5a623' },
    { name: t('map.filter_minimal', { defaultValue: 'Minimal' }), value: stats.minimal, color: '#27ae60' },
  ];

  const typeData = Object.entries(stats.by_type)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.dashboard.title', { defaultValue: 'Dashboard' })}</h1>
          <p className="text-gray-500 text-sm">{t('admin.dashboard.overview', { defaultValue: 'Crisis Assessment Overview' })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={FileText} value={stats.total} label={t('admin.dashboard.total_reports', { defaultValue: 'Total Reports' })} color="bg-un-blue" />
        <StatCard icon={Clock} value={stats.pending} label={t('admin.dashboard.pending_review', { defaultValue: 'Pending Review' })} color="bg-orange-400" />
        <StatCard icon={CheckCircle} value={stats.verified} label={t('map.filter_verified', { defaultValue: 'Verified' })} color="bg-green-500" />
        <StatCard icon={AlertTriangle} value={stats.destroyed} label={t('map.filter_destroyed', { defaultValue: 'Destroyed' })} color="bg-red-500" />
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-1">{t('admin.dashboard.reports_24h', { defaultValue: 'Reports (Last 24h)' })}</h3>
          <p className="text-xs text-gray-400 mb-4">{t('admin.dashboard.total_last_24h', { defaultValue: '{{count}} total in last 24 hours', count: stats.last_24h })}</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={stats.trend}>
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#009edb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-4">{t('admin.dashboard.damage_distribution', { defaultValue: 'Damage Distribution' })}</h3>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={140}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value">
                  {pieData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pieData.map((datum) => (
                <div key={datum.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: datum.color }} />
                  <span className="text-sm text-gray-600">{datum.name}</span>
                  <span className="font-semibold text-sm ml-auto">{datum.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {typeData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h3 className="font-semibold text-gray-800 mb-4">{t('admin.dashboard.by_infra_type', { defaultValue: 'By Infrastructure Type' })}</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={typeData} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="value" fill="#009edb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{t('admin.dashboard.recent_reports', { defaultValue: 'Recent Reports' })}</h3>
          <Link to="/admin/reports" className="text-un-blue text-sm hover:underline">
            {t('admin.dashboard.view_all', { defaultValue: 'View all' })}
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recent.map((report) => (
            <div key={report.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-xs text-gray-400">{report.id}</span>
                  <DamageBadge level={report.damage_level} />
                  <StatusBadge status={report.status} />
                </div>
                <p className="text-sm text-gray-700 truncate">
                  {report.infra_types?.join(', ')} {([report.building_label, report.translations?.[reviewLanguage]?.address_text || report.address_text].filter(Boolean).join(' | ')) ? `- ${[report.building_label, report.translations?.[reviewLanguage]?.address_text || report.address_text].filter(Boolean).join(' | ')}` : ''}
                </p>
                <p className="text-xs text-gray-400">
                  {t('admin.dashboard.via_channel', {
                    defaultValue: '{{time}} via {{channel}}',
                    time: formatRelativeTime(t, report.submitted_at),
                    channel: report.channel,
                  })}
                </p>
              </div>
              {report.is_urgent && <span className="text-red-500 text-xs font-semibold bg-red-50 px-2 py-0.5 rounded-full">{t('common.urgent', { defaultValue: 'URGENT' })}</span>}
              <Link to="/admin/reports" className="text-xs text-un-blue hover:underline flex-shrink-0">
                {t('admin.dashboard.review', { defaultValue: 'Review' })}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

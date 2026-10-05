import express, { Request, Response } from 'express';
import { queryAll, queryOne } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';
import { Report } from '../types';
import { resolveReportMedia } from '../reportMedia';

const router = express.Router();

async function formatReport(r: Report) {
  const media = await resolveReportMedia(r.photos);
  return {
    ...r,
    infra_types: JSON.parse(r.infra_types || '[]'),
    photos: media.photos,
    photo_count: media.photo_count,
    media_state: media.media_state,
    ai_media_eligibility: media.ai_media_eligibility,
    is_urgent: Boolean(r.is_urgent),
  };
}

function damageBadgeColor(level: string): string {
  return level === 'destroyed' ? '#ef4135' : level === 'partial' ? '#f5a623' : '#27ae60';
}

function statusBadgeColor(status: string): string {
  return status === 'verified' ? '#27ae60' : status === 'flagged' ? '#ef4135' : '#f5a623';
}

function formatLocationCell(report: { building_label?: string | null; address_text?: string | null; lat: number | null; lng: number | null }): string {
  return [report.building_label, report.address_text]
    .filter((value) => String(value || '').trim())
    .join('<br/>') || (Number.isFinite(report.lat) && Number.isFinite(report.lng) ? `${Number(report.lat).toFixed(3)}, ${Number(report.lng).toFixed(3)}` : 'Address provided without map coordinates');
}

function generateHtml(reports: any[], crisisName: string, filters: Record<string, string>): string {
  const generated = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
  const counts = {
    total: reports.length,
    destroyed: reports.filter(r => r.damage_level === 'destroyed').length,
    partial: reports.filter(r => r.damage_level === 'partial').length,
    minimal: reports.filter(r => r.damage_level === 'minimal').length,
    urgent: reports.filter(r => r.is_urgent).length,
    verified: reports.filter(r => r.status === 'verified').length,
  };

  const filterSummary = Object.entries(filters)
    .filter(([, v]) => v && v !== 'all')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ') || 'All reports';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Crisis Assessment Report — ${crisisName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 11pt; }
  .cover { background: linear-gradient(135deg, #00205b 0%, #009edb 100%); color: white; padding: 60px 48px; min-height: 200px; }
  .cover .un-logo { font-size: 28pt; font-weight: 900; letter-spacing: -1px; margin-bottom: 4px; }
  .cover h1 { font-size: 22pt; font-weight: 700; margin-bottom: 8px; }
  .cover .subtitle { opacity: 0.8; font-size: 11pt; }
  .cover .meta { margin-top: 24px; opacity: 0.7; font-size: 9pt; }
  .section { padding: 32px 48px; }
  .section-title { font-size: 14pt; font-weight: 700; color: #00205b; border-bottom: 2px solid #009edb; padding-bottom: 8px; margin-bottom: 16px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  .kpi-card { background: #f8faff; border: 1px solid #e0eaff; border-radius: 8px; padding: 16px; text-align: center; }
  .kpi-value { font-size: 28pt; font-weight: 800; color: #009edb; }
  .kpi-label { font-size: 8pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .kpi-card.destroyed .kpi-value { color: #ef4135; }
  .kpi-card.partial .kpi-value { color: #f5a623; }
  .kpi-card.urgent .kpi-value { color: #ef4135; }
  .kpi-card.verified .kpi-value { color: #27ae60; }
  .report-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  .report-table th { background: #00205b; color: white; padding: 8px 10px; text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; }
  .report-table td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .report-table tr:nth-child(even) td { background: #f9f9f9; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 7.5pt; font-weight: 600; color: white; }
  .urgent-row td { background: #fff8f8 !important; }
  .footer { border-top: 1px solid #e0e0e0; padding: 16px 48px; text-align: center; color: #999; font-size: 8pt; }
  .filter-info { background: #f0f8ff; border-left: 3px solid #009edb; padding: 8px 12px; margin-bottom: 24px; font-size: 9pt; color: #555; }
  @media print {
    body { font-size: 10pt; }
    .cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kpi-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="cover">
  <div class="un-logo">🌍 UNDP</div>
  <h1>Community Crisis Assessment Report</h1>
  <div class="subtitle">${crisisName}</div>
  <div class="meta">Generated: ${generated} &nbsp;|&nbsp; ${filterSummary}</div>
</div>

<div class="section">
  <div class="section-title">Executive Summary</div>
  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-value">${counts.total}</div><div class="kpi-label">Total Reports</div></div>
    <div class="kpi-card destroyed"><div class="kpi-value">${counts.destroyed}</div><div class="kpi-label">Completely Destroyed</div></div>
    <div class="kpi-card partial"><div class="kpi-value">${counts.partial}</div><div class="kpi-label">Partial Damage</div></div>
    <div class="kpi-card"><div class="kpi-value">${counts.minimal}</div><div class="kpi-label">Minimal Damage</div></div>
    <div class="kpi-card urgent"><div class="kpi-value">${counts.urgent}</div><div class="kpi-label">🆘 Urgent Cases</div></div>
    <div class="kpi-card verified"><div class="kpi-value">${counts.verified}</div><div class="kpi-label">✅ Verified</div></div>
  </div>

  ${filterSummary !== 'All reports' ? `<div class="filter-info">📋 Filters applied: ${filterSummary}</div>` : ''}
</div>

<div class="section" style="padding-top: 0">
  <div class="section-title">Damage Reports (${reports.length})</div>
  <table class="report-table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Infrastructure</th>
        <th>Damage</th>
        <th>Location</th>
        <th>Submitted</th>
        <th>Status</th>
        <th>Confirms</th>
      </tr>
    </thead>
    <tbody>
      ${reports.map(r => `
      <tr class="${r.is_urgent ? 'urgent-row' : ''}">
        <td><strong>${r.id}</strong>${r.is_urgent ? ' 🆘' : ''}</td>
        <td>${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}</td>
        <td><span class="badge" style="background:${damageBadgeColor(r.damage_level)}">${r.damage_level}</span></td>
        <td style="max-width:140px;overflow:hidden">${formatLocationCell(r)}</td>
        <td>${new Date(r.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
        <td><span class="badge" style="background:${statusBadgeColor(r.status)}">${r.status}</span></td>
        <td style="text-align:center">${r.community_confirms}</td>
      </tr>
      ${r.description ? `<tr class="${r.is_urgent ? 'urgent-row' : ''}"><td colspan="7" style="padding-left:20px;color:#666;font-style:italic;font-size:8.5pt">↳ ${r.description}</td></tr>` : ''}
      `).join('')}
    </tbody>
  </table>
</div>

<div class="footer">
  UNDP Community Crisis Assessment Platform &nbsp;|&nbsp; crisis-platform.com &nbsp;|&nbsp;
  This report was automatically generated. Data reflects community submissions.
  Verified reports have been reviewed by field teams.
</div>

</body>
</html>`;
}

router.get('/', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, damage_level, since, crisis_event } = req.query;
    const filters: Record<string, string> = {};

    let query = 'SELECT * FROM reports WHERE 1=1';
    const params: (string | number)[] = [];

    if (status && status !== 'all') {
      query += ' AND status = ?'; params.push(status as string);
      filters.status = status as string;
    }
    if (damage_level && damage_level !== 'all') {
      query += ' AND damage_level = ?'; params.push(damage_level as string);
      filters.damage_level = damage_level as string;
    }
    if (crisis_event) {
      query += ' AND crisis_event = ?'; params.push(crisis_event as string);
    }
    if (since) {
      query += ' AND submitted_at >= ?'; params.push(since as string);
      filters.since = since as string;
    }

    query += ' ORDER BY is_urgent DESC, submitted_at DESC LIMIT 500';
    const rows = await queryAll<Report>(query, params);
    const reports = await Promise.all(rows.map((row) => formatReport(row)));

    const crisisEvent = await queryOne<{ name: string }>('SELECT name FROM crisis_events WHERE id = ?', [crisis_event || 'default']);
    const crisisName = crisisEvent?.name || 'Active Crisis Response';

    const html = generateHtml(reports, crisisName, filters);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('PDF report generation failed:', err);
    res.status(500).json({ error: 'Report generation failed' });
  }
});

export default router;

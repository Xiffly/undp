import express, { Request, Response } from 'express';
import axios from 'axios';
import { queryOne } from '../dbRuntime';
import { Report } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const router = express.Router();

const recentlyAlerted = new Set<string>();

function formatReport(r: Report) {
  return {
    ...r,
    infra_types: JSON.parse(r.infra_types || '[]'),
    is_urgent: Boolean(r.is_urgent),
  };
}

function formatAlertLocation(report: Report): string {
  return [report.building_label, report.address_text]
    .filter((value) => String(value || '').trim())
    .join(' | ')
    || (Number.isFinite(report.lat) && Number.isFinite(report.lng)
      ? `${Number(report.lat).toFixed(4)}, ${Number(report.lng).toFixed(4)}`
      : 'Address provided without map coordinates');
}

async function sendWebhookAlert(report: any, webhookUrl: string): Promise<void> {
  const domain = process.env.DOMAIN || 'crisis-platform.com';
  const location = formatAlertLocation(report);
  report.address_text = location;
  const payload = {
    text: `URGENT Crisis Report: ${report.id}\n`
      + `Location: ${location}\n`
      + `Infrastructure: ${Array.isArray(report.infra_types) ? report.infra_types.join(', ') : report.infra_types}\n`
      + `Damage: ${report.damage_level?.toUpperCase()}\n`
      + `Description: ${report.description || 'No description'}\n`
      + `Link: https://${domain}/reports/${report.id}`,
    attachments: [{
      color: '#ef4135',
      fields: [
        { title: 'Report ID', value: report.id, short: true },
        { title: 'Damage Level', value: report.damage_level, short: true },
        { title: 'Infrastructure', value: Array.isArray(report.infra_types) ? report.infra_types.join(', ') : '', short: true },
        { title: 'Channel', value: report.channel, short: true },
        { title: 'Location', value: location, short: false },
      ],
      footer: 'UNDP Crisis Platform',
      ts: Math.floor(Date.now() / 1000),
    }],
  };

  await axios.post(webhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
}

export async function checkAndSendAlerts(reportId: string): Promise<void> {
  if (!process.env.ALERT_WEBHOOK_URL) return;
  if (recentlyAlerted.has(reportId)) return;

  const r = await queryOne<Report>('SELECT * FROM reports WHERE id = ? AND is_urgent = 1', [reportId]);
  if (!r) return;

  const report = formatReport(r);
  recentlyAlerted.add(reportId);

  setTimeout(() => recentlyAlerted.delete(reportId), 60 * 60 * 1000);

  try {
    await sendWebhookAlert(report, process.env.ALERT_WEBHOOK_URL);
    console.log(`[Alert] Sent urgent alert for ${reportId} to webhook`);
  } catch (err: any) {
    console.error(`[Alert] Failed to send alert for ${reportId}:`, err.message);
  }
}

router.get('/test', authMiddleware, requireRole('admin'), async (_req: Request, res: Response): Promise<void> => {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    res.json({ status: 'disabled', message: 'Set ALERT_WEBHOOK_URL in .env to enable alerts' });
    return;
  }
  try {
    await sendWebhookAlert({
      id: 'CR-TEST-0001',
      lat: 15.3547, lng: 44.2066,
      building_label: 'Building A',
      address_text: 'Test Location, Sana\'a',
      infra_types: ['house', 'water'],
      damage_level: 'destroyed',
      description: 'This is a test alert from UNDP Crisis Platform.',
      channel: 'web',
    }, webhookUrl);
    res.json({ status: 'ok', message: 'Test alert sent to webhook' });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

export default router;

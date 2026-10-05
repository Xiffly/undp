import express, { Request, Response } from 'express';
import { queryAll, queryOne } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';
import { resolveTranslationsForMany } from './reports';
import { resolveReportMedia } from '../reportMedia';
import { encodeCsvForSpreadsheet } from '../utils/csvEncoding';

const router = express.Router();

function tryParse(val: any, fallback: any) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val || '[]'); } catch { return fallback; }
}

router.get('/', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { format = 'geojson', status, damage_level, crisis_type, since, until, crisis_event, target_lang = 'en' } = req.query;

  let query = 'SELECT * FROM reports WHERE 1=1';
  const params: (string | number)[] = [];

  if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
  if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
  if (crisis_type) { query += ' AND crisis_type = ?'; params.push(crisis_type as string); }
  if (crisis_event) { query += ' AND crisis_event = ?'; params.push(crisis_event as string); }
  if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
  if (until) { query += ' AND submitted_at <= ?'; params.push(until as string); }
  query += ' ORDER BY submitted_at DESC';

  const rows = await queryAll<any>(query, params);
  const targetLang = String(target_lang || 'en').toLowerCase();
  const enrichedRows = await resolveTranslationsForMany(rows, targetLang, { queueMissing: false });
  const timestamp = new Date().toISOString().split('T')[0];

  if (format === 'geojson') {
    const rowsWithMedia = await Promise.all(enrichedRows.map(async (r) => ({
      report: r,
      media: await resolveReportMedia(r.photos),
    })));
    const geojson = {
      type: 'FeatureCollection',
      metadata: {
        generated: new Date().toISOString(),
        total: enrichedRows.length,
        source: 'UNDP Community Crisis Assessment Platform',
        target_language: targetLang,
      },
      features: rowsWithMedia.map(({ report: r, media }) => ({
        type: 'Feature',
        id: r.id,
        geometry: Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))
          ? { type: 'Point', coordinates: [r.lng, r.lat] }
          : null,
        properties: {
          id: r.id,
          damage_level: r.damage_level,
          infra_category: r.infra_category,
          infra_name: r.infra_name,
          infra_name_translated: r.translations?.[targetLang]?.infra_name || null,
          infra_types: tryParse(r.infra_types, []),
          crisis_type: r.crisis_type,
          electricity_condition: r.electricity_condition,
          health_services: r.health_services,
          pressing_needs: tryParse(r.pressing_needs, []),
          has_debris: r.has_debris,
          description: r.description,
          description_translated: r.translations?.[targetLang]?.description || null,
          status: r.status,
          is_urgent: Boolean(r.is_urgent),
          channel: r.channel,
          submitted_at: r.submitted_at,
          building_label: r.building_label || null,
          address_text: r.address_text,
          address_text_translated: r.translations?.[targetLang]?.address_text || null,
          source_language: r.source_language || null,
          translation_status: r.translation_status || null,
          community_confirms: r.community_confirms,
          photo_count: media.photo_count,
          media_state: media.media_state,
          translations: r.translations || {},
        },
      })),
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="crisis-data-${timestamp}.geojson"`);
    res.json(geojson);
    return;
  }

  if (format === 'csv') {
    const headers = [
      'id', 'submitted_at', 'lat', 'lng',
      'building_label',
      'address_text', 'address_text_translated', 'target_language', 'source_language', 'translation_status',
      'infra_category', 'infra_name', 'infra_name_translated', 'crisis_type',
      'damage_level', 'electricity_condition', 'health_services',
      'pressing_needs', 'has_debris',
      'photo_count', 'media_state',
      'description', 'description_translated',
      'status', 'is_urgent', 'channel', 'community_confirms',
    ];
    const csvRows = [headers.join(',')];
    const rowsWithMedia = await Promise.all(enrichedRows.map(async (r) => ({
      report: r,
      media: await resolveReportMedia(r.photos),
    })));
    rowsWithMedia.forEach(({ report: r, media }) => {
      const needs = tryParse(r.pressing_needs, []).join(';');
      const esc = (s: any) => `"${String(s || '').replace(/"/g, '""')}"`;
      const row = [
        r.id, r.submitted_at, r.lat, r.lng,
        esc(r.building_label),
        esc(r.address_text), esc(r.translations?.[targetLang]?.address_text), esc(targetLang), esc(r.source_language), esc(r.translation_status),
        esc(r.infra_category), esc(r.infra_name), esc(r.translations?.[targetLang]?.infra_name), esc(r.crisis_type),
        r.damage_level, esc(r.electricity_condition), esc(r.health_services),
        esc(needs), esc(r.has_debris),
        media.photo_count, esc(media.media_state),
        esc(r.description), esc(r.translations?.[targetLang]?.description),
        r.status, r.is_urgent ? 1 : 0, r.channel, r.community_confirms,
      ];
      csvRows.push(row.join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="crisis-data-${timestamp}.csv"`);
    res.send(encodeCsvForSpreadsheet(csvRows.join('\n')));
    return;
  }

  if (format === 'json') {
    const reportsWithMedia = await Promise.all(enrichedRows.map(async (r) => {
      const media = await resolveReportMedia(r.photos);
      return {
        ...r,
        infra_types: tryParse(r.infra_types, []),
        pressing_needs: tryParse(r.pressing_needs, []),
        photos: media.photos,
        photo_keys: media.stored_keys,
        photo_count: media.photo_count,
        media_state: media.media_state,
        ai_media_eligibility: media.ai_media_eligibility,
        is_urgent: Boolean(r.is_urgent),
      };
    }));
    const data = {
      metadata: {
        generated: new Date().toISOString(),
        total: enrichedRows.length,
        source: 'UNDP Community Crisis Assessment Platform',
        target_language: targetLang,
      },
      reports: reportsWithMedia,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="crisis-data-${timestamp}.json"`);
    res.json(data);
    return;
  }

  if (format === 'kml') {
    const rowsWithMedia = await Promise.all(enrichedRows.map(async (r) => ({
      report: r,
      media: await resolveReportMedia(r.photos),
    })));
    const colorMap: Record<string, string> = {
      destroyed: 'ff0000ff', partial: 'ff00a5ff', minimal: 'ff00b400',
    };
    const placemarks = rowsWithMedia.map(({ report: r, media }) => `
    <Placemark>
      <name>${r.id}</name>
      <description><![CDATA[
        <b>Damage:</b> ${r.damage_level}<br/>
        <b>Category:</b> ${r.infra_category || ''}${r.infra_name ? ` - ${r.infra_name}` : ''}<br/>
        ${r.translations?.[targetLang]?.infra_name ? `<b>Category (${targetLang.toUpperCase()}):</b> ${r.translations[targetLang].infra_name}<br/>` : ''}
        <b>Crisis Type:</b> ${r.crisis_type || 'unknown'}<br/>
        <b>Electricity:</b> ${r.electricity_condition || 'unknown'}<br/>
        <b>Health:</b> ${r.health_services || 'unknown'}<br/>
        <b>Debris:</b> ${r.has_debris || 'unknown'}<br/>
        <b>Needs:</b> ${tryParse(r.pressing_needs, []).join(', ')}<br/>
        <b>Status:</b> ${r.status}<br/>
        <b>Date:</b> ${r.submitted_at}<br/>
        ${r.building_label ? `<b>Building:</b> ${r.building_label}<br/>` : ''}
        ${r.address_text ? `<b>Location:</b> ${r.address_text}<br/>` : ''}
        <b>Photos:</b> ${media.photo_count}<br/>
        <b>Media state:</b> ${media.media_state}<br/>
        ${r.source_language ? `<b>Source language:</b> ${r.source_language}<br/>` : ''}
        ${r.description ? `<b>Description:</b> ${r.description}<br/>` : ''}
        ${r.translations?.[targetLang]?.description ? `<b>Description (${targetLang.toUpperCase()}):</b> ${r.translations[targetLang].description}` : ''}
      ]]></description>
      <Style><IconStyle><color>${colorMap[r.damage_level] || 'ffffffff'}</color>
        <Icon><href>http://maps.google.com/mapfiles/ms/icons/red-dot.png</href></Icon>
      </IconStyle></Style>
      ${Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)) ? `<Point><coordinates>${r.lng},${r.lat},0</coordinates></Point>` : ''}
    </Placemark>`).join('');

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>UNDP Crisis Assessment Data - ${timestamp}</name>
    <description>Exported from UNDP Community Crisis Assessment Platform</description>
    ${placemarks}
  </Document>
</kml>`;
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.setHeader('Content-Disposition', `attachment; filename="crisis-data-${timestamp}.kml"`);
    res.send(kml);
    return;
  }

  res.status(400).json({ error: 'Invalid format. Use: geojson, json, csv, kml' });
});

router.get('/count', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { status, damage_level, crisis_type, since, until } = req.query;
  let query = 'SELECT COUNT(*) as c FROM reports WHERE 1=1';
  const params: (string | number)[] = [];
  if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
  if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
  if (crisis_type) { query += ' AND crisis_type = ?'; params.push(crisis_type as string); }
  if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
  if (until) { query += ' AND submitted_at <= ?'; params.push(until as string); }
  const result = await queryOne<{ c: number }>(query, params) as { c: number };
  res.json({ count: result.c });
});

export default router;

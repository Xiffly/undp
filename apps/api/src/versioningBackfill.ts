import { queryAll, queryOne, execute } from './dbRuntime';
import { getModerationSettings } from './services/moderationSettings';

function metersToLatitudeDegrees(radiusM: number): number {
  return radiusM / 111320;
}

function metersToLongitudeDegrees(radiusM: number, lat: number): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cosLat), 0.01);
  return radiusM / (111320 * safeCos);
}

export async function backfillReportVersioning(): Promise<void> {
  const moderationSettings = await getModerationSettings();
  const rows = await queryAll<any>(
    `SELECT id, lat, lng, building_label, address_text, submitted_at, damage_level, infra_category, crisis_type
     FROM reports
     WHERE location_id IS NULL OR location_id = ''
     ORDER BY submitted_at ASC, id ASC`
  );

  for (const r of rows) {
    const latTol = metersToLatitudeDegrees(moderationSettings.duplicateRadiusM);
    const lngTol = metersToLongitudeDegrees(moderationSettings.duplicateRadiusM, Number(r.lat));
    const nearby = await queryOne<{ id: string }>(
      `SELECT id FROM report_locations
       WHERE ABS(lat - ?) <= ? AND ABS(lng - ?) <= ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [r.lat, latTol, r.lng, lngTol]
    );

    let locationId = nearby?.id;
    if (!locationId) {
      locationId = `loc_bf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await execute(
        'INSERT INTO report_locations (id, lat, lng, building_label, address_text, last_report_id) VALUES (?, ?, ?, ?, ?, ?)',
        [locationId, r.lat, r.lng, r.building_label || null, r.address_text || null, r.id]
      );
    }

    const next = await queryOne<{ v: number }>(
      'SELECT COALESCE(MAX(version_number), 0) + 1 AS v FROM reports WHERE location_id = ?',
      [locationId]
    );
    const versionNumber = next?.v || 1;

    await execute(
      'UPDATE reports SET location_id = ?, version_number = ? WHERE id = ?',
      [locationId, versionNumber, r.id]
    );

    await execute(
      'UPDATE report_locations SET updated_at = datetime(\'now\'), building_label = COALESCE(?, building_label), address_text = COALESCE(?, address_text), last_report_id = ? WHERE id = ?',
      [r.building_label || null, r.address_text || null, r.id, locationId]
    );

    await execute(
      'INSERT INTO report_versions (id, location_id, report_id, version_number, change_type, submitted_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        `rv_${r.id}`,
        locationId,
        r.id,
        versionNumber,
        'backfill',
        r.submitted_at,
        JSON.stringify({
          lat: r.lat,
          lng: r.lng,
          building_label: r.building_label || null,
          address_text: r.address_text || null,
          damage_level: r.damage_level,
          infra_category: r.infra_category,
          crisis_type: r.crisis_type,
        }),
      ]
    );
  }
}

import express, { Request, Response } from 'express';
import multer from 'multer';
import { randomUUID as uuidv4 } from 'node:crypto';
import { execute, queryAll, queryOne } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/json'
      || file.mimetype === 'application/geo+json'
      || file.originalname.endsWith('.geojson')
      || file.originalname.endsWith('.json')
    ) {
      cb(null, true);
      return;
    }
    cb(new Error('Only GeoJSON files (.geojson or .json) are accepted'));
  },
});

type FootprintSetRow = {
  id: string;
  crisis_event_id: string;
  name: string;
  description?: string | null;
  geojson: unknown;
  feature_count: number;
  uploaded_by?: string | null;
  created_at: string;
  updated_at?: string;
};

type FootprintFeatureProperties = Record<string, unknown> & {
  footprint_set_id?: string;
  feature_id?: string;
  feature_key?: string;
};

type FootprintGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
};

type FootprintFeature = {
  type: 'Feature';
  id?: string;
  geometry: FootprintGeometry;
  properties?: FootprintFeatureProperties;
};

type FootprintCollection = {
  type: 'FeatureCollection';
  features: FootprintFeature[];
};

function sanitizeText(value: unknown, maxLen = 240): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"']/g, '')
    .trim()
    .slice(0, maxLen);
}

function parseStoredGeojson(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function isFootprintGeometry(geometry: unknown): geometry is FootprintGeometry {
  if (!geometry || typeof geometry !== 'object') return false;
  const type = String((geometry as { type?: string }).type || '');
  return type === 'Polygon' || type === 'MultiPolygon';
}

function pickFeatureId(feature: FootprintFeature, index: number): string {
  const props = (feature.properties || {}) as Record<string, unknown>;
  const candidates = [
    feature.id,
    props.feature_id,
    props.id,
    props.osm_id,
    props['@id'],
    props.uuid,
    props.uid,
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeText(candidate, 180);
    if (normalized) return normalized;
  }
  return `feature_${index + 1}`;
}

function pickFeatureKey(feature: FootprintFeature, index: number): string {
  const props = (feature.properties || {}) as Record<string, unknown>;
  const id = pickFeatureId(feature, index);
  const candidates = [
    props.feature_key,
    props.building_id,
    props.osm_way_id,
    props.osm_id,
    props['@id'],
    id,
  ];
  for (const candidate of candidates) {
    const normalized = sanitizeText(candidate, 240);
    if (normalized) return normalized;
  }
  return `key_${index + 1}`;
}

function normalizeGeojson(raw: unknown, footprintSetId: string): FootprintCollection {
  const parsed = parseStoredGeojson(raw);
  const features: FootprintFeature[] = [];

  const appendFeature = (feature: FootprintFeature, index: number) => {
    if (!isFootprintGeometry(feature.geometry)) return;
    const featureId = pickFeatureId(feature, index);
    const featureKey = pickFeatureKey(feature, index);
    const properties = {
      ...((feature.properties || {}) as FootprintFeatureProperties),
      footprint_set_id: footprintSetId,
      feature_id: featureId,
      feature_key: featureKey,
    };
    features.push({
      type: 'Feature',
      id: featureId,
      geometry: feature.geometry,
      properties,
    });
  };

  if (parsed && typeof parsed === 'object') {
    const typed = parsed as { type?: string; features?: FootprintFeature[] };
    if (typed.type === 'FeatureCollection' && Array.isArray(typed.features)) {
      typed.features.forEach((feature, index) => appendFeature(feature, index));
    } else if (typed.type === 'Feature') {
      appendFeature(typed as FootprintFeature, 0);
    } else if (isFootprintGeometry(typed)) {
      appendFeature({ type: 'Feature', geometry: typed, properties: {} }, 0);
    }
  }

  return { type: 'FeatureCollection', features };
}

async function getFootprintSet(footprintId: string): Promise<FootprintSetRow | undefined> {
  return queryOne<FootprintSetRow>(
    `SELECT id, crisis_event_id, name, description, geojson, feature_count, uploaded_by, created_at, updated_at
     FROM building_footprint_sets
     WHERE id = ?`,
    [footprintId]
  );
}

router.get('/:crisisEventId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const rows = await queryAll<FootprintSetRow>(
    `SELECT id, crisis_event_id, name, description, feature_count, uploaded_by, created_at, updated_at
     FROM building_footprint_sets
     WHERE crisis_event_id = ?
     ORDER BY created_at DESC`,
    [req.params.crisisEventId]
  );
  res.json({ footprints: rows });
});

router.get('/:crisisEventId/public', async (req: Request, res: Response): Promise<void> => {
  const rows = await queryAll<FootprintSetRow>(
    `SELECT id, crisis_event_id, name, description, geojson, feature_count, created_at
     FROM building_footprint_sets
     WHERE crisis_event_id = ?
     ORDER BY created_at DESC`,
    [req.params.crisisEventId]
  );

  const merged: FootprintFeature[] = [];
  for (const row of rows) {
    const collection = normalizeGeojson(row.geojson, row.id);
    for (const feature of collection.features) {
      feature.properties = {
        ...feature.properties,
        footprint_set_name: row.name,
        footprint_set_description: row.description || null,
      };
      merged.push(feature);
    }
  }

  res.json({ type: 'FeatureCollection', features: merged });
});

router.get('/:crisisEventId/:footprintId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const row = await getFootprintSet(req.params.footprintId);
  if (!row || row.crisis_event_id !== req.params.crisisEventId) {
    res.status(404).json({ error: 'Footprint set not found' });
    return;
  }

  res.json({
    footprint: {
      ...row,
      geojson: normalizeGeojson(row.geojson, row.id),
    },
  });
});

router.post(
  '/:crisisEventId',
  authMiddleware,
  requireRole('team_lead'),
  upload.single('geojson'),
  async (req: Request, res: Response): Promise<void> => {
    const fileRequest = req as Request & { file?: { buffer: Buffer } };
    const name = sanitizeText(req.body?.name, 160);
    const description = sanitizeText(req.body?.description, 500) || null;

    if (!name) {
      res.status(400).json({ error: 'Layer name is required' });
      return;
    }
    if (!fileRequest.file) {
      res.status(400).json({ error: 'GeoJSON file is required' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(fileRequest.file.buffer.toString('utf-8'));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid GeoJSON' });
      return;
    }

    const id = `fps_${uuidv4()}`;
    const normalized = normalizeGeojson(parsed, id);
    if (normalized.features.length === 0) {
      res.status(400).json({ error: 'GeoJSON must contain Polygon or MultiPolygon features' });
      return;
    }

    await execute(
      `INSERT INTO building_footprint_sets
       (id, crisis_event_id, name, description, geojson, feature_count, uploaded_by)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [
        id,
        req.params.crisisEventId,
        name,
        description,
        JSON.stringify(normalized),
        normalized.features.length,
        (req as { user?: { email?: string; id?: string } }).user?.email
          || (req as { user?: { id?: string } }).user?.id
          || 'team_lead',
      ]
    );

    res.status(201).json({
      footprint: {
        id,
        crisis_event_id: req.params.crisisEventId,
        name,
        description,
        feature_count: normalized.features.length,
      },
      message: `Uploaded ${normalized.features.length} building footprints`,
    });
  }
);

router.patch('/:crisisEventId/:footprintId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const row = await getFootprintSet(req.params.footprintId);
  if (!row || row.crisis_event_id !== req.params.crisisEventId) {
    res.status(404).json({ error: 'Footprint set not found' });
    return;
  }

  const nextName = req.body?.name !== undefined ? sanitizeText(req.body.name, 160) : row.name;
  const nextDescription = req.body?.description !== undefined
    ? sanitizeText(req.body.description, 500) || null
    : (row.description || null);

  await execute(
    `UPDATE building_footprint_sets
     SET name = ?, description = ?, updated_at = NOW()
     WHERE id = ?`,
    [nextName, nextDescription, row.id]
  );

  res.json({
    footprint: {
      ...row,
      name: nextName,
      description: nextDescription,
    },
  });
});

router.delete('/:crisisEventId/:footprintId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const row = await getFootprintSet(req.params.footprintId);
  if (!row || row.crisis_event_id !== req.params.crisisEventId) {
    res.status(404).json({ error: 'Footprint set not found' });
    return;
  }

  await execute('DELETE FROM building_footprint_sets WHERE id = ?', [row.id]);
  res.json({ success: true });
});

export default router;

import '../loadEnv';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execute, initRuntimeDb, queryAll, queryOne } from '../dbRuntime';

type SharedAsset = {
  key: string;
  source: string;
};

type ReportPhotoRow = {
  id: string;
  damage_level: 'minimal' | 'partial' | 'destroyed' | string;
  photos: unknown;
};

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_STAGE_DIR = path.join(WORKSPACE_ROOT, 'release_bundle', 'uploads');

const SHARED_ASSETS: Record<'minimal' | 'partial' | 'destroyed', SharedAsset[]> = {
  minimal: [
    {
      key: 'reports/2026/06/afd56aca-3d78-4dce-8c20-35a501b84ac8.png',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', 'afd56aca-3d78-4dce-8c20-35a501b84ac8.png'),
    },
    {
      key: 'reports/2026/06/7bb06694-0a95-4283-9366-b9db1317cdf2.jpg',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '7bb06694-0a95-4283-9366-b9db1317cdf2.jpg'),
    },
  ],
  partial: [
    {
      key: 'reports/2026/06/3022587d-e8ea-4270-a82d-111516a56259.jpg',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '3022587d-e8ea-4270-a82d-111516a56259.jpg'),
    },
    {
      key: 'reports/2026/06/677d0bd8-d380-4b5c-aa17-6ec919f15b60.jpg',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '677d0bd8-d380-4b5c-aa17-6ec919f15b60.jpg'),
    },
    {
      key: 'reports/2026/06/5f59d7de-091e-4a5f-bbd9-1b02ca82e88c.png',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '5f59d7de-091e-4a5f-bbd9-1b02ca82e88c.png'),
    },
  ],
  destroyed: [
    {
      key: 'reports/2026/06/1b1af8ad-d16c-44fa-8935-0d843f3fde7b.jpg',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '1b1af8ad-d16c-44fa-8935-0d843f3fde7b.jpg'),
    },
    {
      key: 'reports/2026/06/291c7fa8-3893-4b19-9f37-f20d43cd1b0e.jpg',
      source: path.join(WORKSPACE_ROOT, 'uploads_mvp_only', 'reports', '2026', '06', '291c7fa8-3893-4b19-9f37-f20d43cd1b0e.jpg'),
    },
  ],
};

function parseArgs() {
  const args = process.argv.slice(2);
  let stageDir = DEFAULT_STAGE_DIR;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--stage-dir' && args[index + 1]) {
      stageDir = path.resolve(args[index + 1]);
      index += 1;
    }
  }

  return { dryRun, stageDir };
}

function parsePhotoKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsePhotoKeys(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function pickSharedAsset(reportId: string, damageLevel: string): SharedAsset {
  const group = damageLevel === 'minimal' || damageLevel === 'destroyed' ? damageLevel : 'partial';
  const assets = SHARED_ASSETS[group];
  const hash = createHash('sha1').update(reportId).digest();
  const selectedIndex = hash[0] % assets.length;
  return assets[selectedIndex];
}

function ensureSharedAssets(stageDir: string) {
  let totalBytes = 0;
  const copied: Array<{ key: string; bytes: number }> = [];
  const seen = new Set<string>();

  for (const assetGroup of Object.values(SHARED_ASSETS)) {
    for (const asset of assetGroup) {
      if (seen.has(asset.key)) continue;
      seen.add(asset.key);

      if (!fs.existsSync(asset.source)) {
        throw new Error(`Missing shared asset source: ${asset.source}`);
      }

      const bytes = fs.statSync(asset.source).size;
      totalBytes += bytes;
      copied.push({ key: asset.key, bytes });

      const destination = path.join(stageDir, asset.key);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(asset.source, destination);
    }
  }

  return { copied, totalBytes };
}

async function main() {
  const { dryRun, stageDir } = parseArgs();
  await initRuntimeDb();

  const rows = await queryAll<ReportPhotoRow>(
    'SELECT id, damage_level, photos FROM reports ORDER BY id'
  );

  const totalReports = rows.length;
  const withPhotos = rows.filter((row) => parsePhotoKeys(row.photos).length > 0);
  const withoutPhotos = totalReports - withPhotos.length;

  const remappedPreview = withPhotos.slice(0, 10).map((row) => ({
    id: row.id,
    damage_level: row.damage_level,
    next_key: pickSharedAsset(row.id, row.damage_level).key,
  }));

  if (!dryRun) {
    for (const row of withPhotos) {
      const nextKey = pickSharedAsset(row.id, row.damage_level).key;
      await execute('UPDATE reports SET photos = ?::jsonb WHERE id = ?', [JSON.stringify([nextKey]), row.id]);
    }
  }

  let stageInfo = {
    copied: [] as Array<{ key: string; bytes: number }>,
    totalBytes: 0,
  };
  if (!dryRun) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    stageInfo = ensureSharedAssets(stageDir);
  }
  const distinctReferenced = dryRun
    ? new Set(withPhotos.map((row) => pickSharedAsset(row.id, row.damage_level).key)).size
    : Number((await queryOne<{ c: string | number }>(
      "SELECT COUNT(DISTINCT value) AS c FROM reports, jsonb_array_elements_text(photos) AS value WHERE jsonb_array_length(photos) > 0"
    ))?.c || 0);

  const manifest = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    total_reports: totalReports,
    reports_with_photos: withPhotos.length,
    reports_without_photos: withoutPhotos,
    distinct_referenced_uploads: distinctReferenced,
    staged_upload_bytes: stageInfo.totalBytes,
    staged_upload_mb: Number((stageInfo.totalBytes / (1024 * 1024)).toFixed(2)),
    shared_assets: stageInfo.copied,
    preview: remappedPreview,
  };

  fs.mkdirSync(path.join(stageDir, '..'), { recursive: true });
  fs.writeFileSync(
    path.join(stageDir, '..', 'minimal-mvp-media-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

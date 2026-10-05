import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type MediaUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
};

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

const ALLOWED_PUBLIC_IMAGE_MIME_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
]);

const MEDIA_BACKEND = (process.env.MEDIA_BACKEND || 'local').trim().toLowerCase();
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || '').trim();
const S3_BUCKET = (process.env.S3_BUCKET || '').trim();
const S3_REGION = (process.env.S3_REGION || 'auto').trim();
const S3_ENDPOINT = (process.env.S3_ENDPOINT || '').trim();
const S3_ACCESS_KEY_ID = (process.env.S3_ACCESS_KEY_ID || '').trim();
const S3_SECRET_ACCESS_KEY = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
const MEDIA_SIGNED_URL_TTL_SECONDS = Math.max(60, parseInt(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || '900', 10));
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const PRIMARY_LOCAL_UPLOADS_DIR = path.join(WORKSPACE_ROOT, 'uploads');
const LEGACY_LOCAL_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

let s3Client: S3Client | null = null;

function ensureLocalDir(): void {
  if (!fs.existsSync(PRIMARY_LOCAL_UPLOADS_DIR)) {
    fs.mkdirSync(PRIMARY_LOCAL_UPLOADS_DIR, { recursive: true });
  }
}

function getCandidateLocalPaths(key: string): string[] {
  const normalized = normalizeStoredKey(key);
  if (!normalized) return [];
  const primary = path.join(PRIMARY_LOCAL_UPLOADS_DIR, normalized);
  const legacy = path.join(LEGACY_LOCAL_UPLOADS_DIR, normalized);
  return primary === legacy ? [primary] : [primary, legacy];
}

function resolveExistingLocalPath(key: string): string | null {
  for (const candidate of getCandidateLocalPaths(key)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getS3Client(): S3Client {
  if (!S3_BUCKET) {
    throw new Error('S3_BUCKET is required when MEDIA_BACKEND=s3');
  }
  if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 credentials are required when MEDIA_BACKEND=s3');
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(S3_ENDPOINT),
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export function isAllowedPublicImageMimeType(mimetype: string): boolean {
  return ALLOWED_PUBLIC_IMAGE_MIME_TYPES.has(String(mimetype || '').toLowerCase());
}

function normalizeExt(_originalname: string, mimetype: string): string {
  return ALLOWED_PUBLIC_IMAGE_MIME_TYPES.get(String(mimetype || '').toLowerCase()) || '.jpg';
}

function createObjectKey(originalname: string, mimetype: string, prefix = 'reports'): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = normalizeExt(originalname, mimetype);
  return `${prefix}/${year}/${month}/${randomUUID()}${ext}`;
}

function hasBytes(buffer: Buffer, start: number, bytes: number[]): boolean {
  if (buffer.length < start + bytes.length) return false;
  return bytes.every((value, index) => buffer[start + index] === value);
}

function readAscii(buffer: Buffer, start: number, length: number): string {
  if (buffer.length < start + length) return '';
  return buffer.toString('ascii', start, start + length);
}

export function detectActualPublicImageMimeType(buffer: Buffer): string | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (hasBytes(buffer, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasBytes(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (readAscii(buffer, 0, 6) === 'GIF87a' || readAscii(buffer, 0, 6) === 'GIF89a') return 'image/gif';
  if (readAscii(buffer, 0, 4) === 'RIFF' && readAscii(buffer, 8, 4) === 'WEBP') return 'image/webp';
  if (readAscii(buffer, 4, 4) === 'ftyp') {
    const brands = new Set<string>();
    for (let offset = 8; offset + 4 <= Math.min(buffer.length, 32); offset += 4) {
      brands.add(readAscii(buffer, offset, 4));
    }
    if (brands.has('avif') || brands.has('avis')) return 'image/avif';
  }
  return null;
}

export function validatePublicImageUpload(file: MediaUpload): string {
  const declaredMimeType = String(file.mimetype || '').toLowerCase();
  if (!isAllowedPublicImageMimeType(declaredMimeType)) {
    throw new MediaValidationError('Only JPEG, PNG, WebP, GIF, and AVIF images are allowed');
  }
  const detectedMimeType = detectActualPublicImageMimeType(file.buffer);
  if (!detectedMimeType || !isAllowedPublicImageMimeType(detectedMimeType)) {
    throw new MediaValidationError('Uploaded file is not a valid supported image');
  }
  if (detectedMimeType !== declaredMimeType) {
    throw new MediaValidationError('Uploaded image content does not match the declared file type');
  }
  return detectedMimeType;
}

export function normalizeStoredKey(key: string): string {
  return key.replace(/^\/+/, '').replace(/\\/g, '/');
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function getMediaBackend(): 'local' | 's3' {
  return MEDIA_BACKEND === 's3' ? 's3' : 'local';
}

export async function saveMediaFile(file: MediaUpload, prefix = 'reports'): Promise<string> {
  const verifiedMimeType = validatePublicImageUpload(file);
  const key = createObjectKey(file.originalname, verifiedMimeType, prefix);
  if (getMediaBackend() === 'local') {
    ensureLocalDir();
    const fullPath = path.join(PRIMARY_LOCAL_UPLOADS_DIR, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.buffer);
    return key;
  }

  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: verifiedMimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return key;
}

export async function deleteMediaKeys(keys: string[]): Promise<void> {
  const normalized = keys.map(normalizeStoredKey).filter(Boolean);
  if (!normalized.length) return;

  if (getMediaBackend() === 'local') {
    for (const key of normalized) {
      for (const candidate of getCandidateLocalPaths(key)) {
        if (fs.existsSync(candidate)) {
          fs.unlinkSync(candidate);
        }
      }
    }
    return;
  }

  const client = getS3Client();
  await Promise.all(normalized.map((key) => client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  }))));
}

export async function buildMediaUrl(key: string): Promise<string> {
  const normalized = normalizeStoredKey(key);
  if (getMediaBackend() === 'local') {
    return `/uploads/${normalized}`;
  }

  if (MEDIA_PUBLIC_BASE_URL) {
    return `${MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '')}/${normalized}`;
  }

  const client = getS3Client();
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalized,
  }), { expiresIn: MEDIA_SIGNED_URL_TTL_SECONDS });
}

export async function buildMediaUrls(keys: string[]): Promise<string[]> {
  return Promise.all(keys.map((key) => buildMediaUrl(key)));
}

export async function readMediaBuffer(key: string): Promise<Buffer> {
  const normalized = normalizeStoredKey(key);
  if (getMediaBackend() === 'local') {
    const existingPath = resolveExistingLocalPath(normalized);
    if (!existingPath) {
      throw new Error(`Local media file not found: ${normalized}`);
    }
    return fs.readFileSync(existingPath);
  }

  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: normalized,
  }));
  if (!response.Body) {
    throw new Error('Media object body missing');
  }
  return streamToBuffer(response.Body as Readable);
}

export async function mediaKeyExists(key: string): Promise<boolean> {
  const normalized = normalizeStoredKey(key);
  if (!normalized) return false;
  if (getMediaBackend() === 'local') {
    return Boolean(resolveExistingLocalPath(normalized));
  }

  try {
    const client = getS3Client();
    await client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: normalized,
    }));
    return true;
  } catch {
    return false;
  }
}

export function getLocalMediaPath(key: string): string {
  return path.join(PRIMARY_LOCAL_UPLOADS_DIR, normalizeStoredKey(key));
}

export function getPrimaryLocalUploadsDir(): string {
  return PRIMARY_LOCAL_UPLOADS_DIR;
}

export function getLegacyLocalUploadsDir(): string {
  return LEGACY_LOCAL_UPLOADS_DIR;
}

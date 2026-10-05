import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'node:crypto';

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) return null;
  try {
    const metaRes = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
    });
    const mediaUrl: string = metaRes.data?.url;
    if (!mediaUrl) return null;
    const fileRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` }, responseType: 'arraybuffer', timeout: 30000,
    });
    const contentType = String(fileRes.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
    const extMap: Record<string, string> = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
    const filename = `wa_${uuidv4()}${extMap[contentType] || '.jpg'}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(fileRes.data));
    return filename;
  } catch (err: any) {
    console.error('[WhatsApp] Media download failed:', err.message);
    return null;
  }
}

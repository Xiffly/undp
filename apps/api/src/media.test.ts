import fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteMediaKeys,
  detectActualPublicImageMimeType,
  getLocalMediaPath,
  saveMediaFile,
  validatePublicImageUpload,
} from './media';

const ONE_PIXEL_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082',
  'hex'
);

const ONE_PIXEL_GIF = Buffer.from(
  '47494638396101000100800000000000FFFFFF21F90401000000002C00000000010001000002024401003B',
  'hex'
);

const createdKeys: string[] = [];

afterEach(async () => {
  if (createdKeys.length) {
    await deleteMediaKeys([...createdKeys]);
    createdKeys.length = 0;
  }
});

describe('media upload validation', () => {
  it('detects supported image signatures from file bytes', () => {
    expect(detectActualPublicImageMimeType(ONE_PIXEL_PNG)).toBe('image/png');
    expect(detectActualPublicImageMimeType(ONE_PIXEL_GIF)).toBe('image/gif');
    expect(detectActualPublicImageMimeType(Buffer.from('not-an-image'))).toBeNull();
  });

  it('accepts real images and stores them with the detected extension', async () => {
    const key = await saveMediaFile({
      buffer: ONE_PIXEL_PNG,
      mimetype: 'image/png',
      originalname: 'spoofed-name.jpg',
    }, 'reports');
    createdKeys.push(key);

    expect(key).toMatch(/^reports\/\d{4}\/\d{2}\/.+\.png$/);
    expect(fs.existsSync(getLocalMediaPath(key))).toBe(true);
  });

  it('rejects spoofed files whose bytes do not match the declared image type', () => {
    expect(() => validatePublicImageUpload({
      buffer: Buffer.from('this is text, not an image'),
      mimetype: 'image/png',
      originalname: 'fake.png',
    })).toThrow('Uploaded file is not a valid supported image');
  });

  it('rejects mismatched image signatures even when both formats are allowed', () => {
    expect(() => validatePublicImageUpload({
      buffer: ONE_PIXEL_GIF,
      mimetype: 'image/png',
      originalname: 'wrong.png',
    })).toThrow('Uploaded image content does not match the declared file type');
  });
});

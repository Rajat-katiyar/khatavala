import { createHash } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * PLUGGABLE IMAGE STORAGE
 * =======================
 * Product images need somewhere to live. Which somewhere depends on the
 * deployment, so this is an adapter with two drivers rather than a hard-coded
 * choice:
 *
 *   local      (default) — writes under ./uploads and serves it statically.
 *                          Works with no configuration, which matters because
 *                          a developer cloning this repo should be able to
 *                          upload an image without first signing up for a CDN.
 *   cloudinary          — activated by setting CLOUDINARY_* in the env.
 *
 * The Cloudinary driver talks to their REST API with a signed request instead
 * of pulling in the SDK: the upload is one multipart POST and the signature is
 * a SHA-1, so the dependency would be ~2MB to save ten lines.
 *
 * Adding S3 later means adding a driver here and nothing else — callers only
 * ever see `uploadImage`/`deleteImage`.
 */

export type StorageDriver = 'local' | 'cloudinary';

export function activeDriver(): StorageDriver {
  return env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
    ? 'cloudinary'
    : 'local';
}

export interface StoredImage {
  url: string;
  /** Driver-specific handle used to delete it later. */
  key: string;
  driver: StorageDriver;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function assertImage(file: { mimetype: string; size: number }) {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    throw ApiError.badRequest('Upload a JPEG, PNG, WebP or GIF image');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw ApiError.badRequest('That image is larger than 5 MB');
  }
}

const extensionFor = (mimetype: string) =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  })[mimetype] ?? 'bin';

/* --------------------------------- local -------------------------------- */

/** Files live under uploads/<companyId>/ so a tenant's images are separable. */
export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

async function uploadLocal(
  buffer: Buffer,
  mimetype: string,
  companyId: string
): Promise<StoredImage> {
  const dir = path.join(UPLOAD_ROOT, companyId);
  await mkdir(dir, { recursive: true });

  const filename = `${randomUUID()}.${extensionFor(mimetype)}`;
  await writeFile(path.join(dir, filename), buffer);

  const key = `${companyId}/${filename}`;
  return { url: `/uploads/${key}`, key, driver: 'local' };
}

async function deleteLocal(key: string) {
  // Resolve and confirm the path stays inside UPLOAD_ROOT. `key` comes from a
  // stored URL, but treating it as trusted is how a "../../.env" delete
  // happens; the check costs nothing.
  const target = path.resolve(UPLOAD_ROOT, key);
  if (!target.startsWith(UPLOAD_ROOT + path.sep)) {
    throw ApiError.badRequest('Invalid image reference');
  }
  await unlink(target).catch((err: NodeJS.ErrnoException) => {
    // Already gone is a success for a delete.
    if (err.code !== 'ENOENT') throw err;
  });
}

/* ------------------------------ cloudinary ------------------------------ */

async function uploadCloudinary(
  buffer: Buffer,
  mimetype: string,
  companyId: string
): Promise<StoredImage> {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `khatavala/${companyId}`;

  // Cloudinary signs the alphabetically-sorted params, secret appended.
  const toSign = `folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signature = createHash('sha1').update(toSign).digest('hex');

  const form = new FormData();
  // `new Uint8Array(buffer)` rather than the Buffer itself: TS types Buffer's
  // backing store as ArrayBufferLike, which may be a SharedArrayBuffer and so
  // is not a valid BlobPart. The view is a plain ArrayBuffer and copies nothing.
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }));
  form.append('api_key', env.CLOUDINARY_API_KEY!);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: form }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error(`Cloudinary upload failed (${response.status}): ${detail}`);
    throw new ApiError(502, 'The image service rejected that upload', 'UPLOAD_FAILED');
  }

  const result = (await response.json()) as { secure_url: string; public_id: string };
  return { url: result.secure_url, key: result.public_id, driver: 'cloudinary' };
}

async function deleteCloudinary(key: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${key}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signature = createHash('sha1').update(toSign).digest('hex');

  const form = new FormData();
  form.append('public_id', key);
  form.append('api_key', env.CLOUDINARY_API_KEY!);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
    { method: 'POST', body: form }
  );

  // A failed delete leaves an orphaned file, which costs storage but breaks
  // nothing — log it rather than failing the caller's request.
  if (!response.ok) {
    logger.warn(`Cloudinary delete failed for ${key} (${response.status})`);
  }
}

/* --------------------------------- API ---------------------------------- */

export async function uploadImage(
  buffer: Buffer,
  mimetype: string,
  companyId: string
): Promise<StoredImage> {
  return activeDriver() === 'cloudinary'
    ? uploadCloudinary(buffer, mimetype, companyId)
    : uploadLocal(buffer, mimetype, companyId);
}

/**
 * Removes a previously stored image, given the URL that was saved on the
 * product. Never throws for a missing file — deleting an image that is already
 * gone is the outcome the caller wanted.
 */
export async function deleteImageByUrl(url: string | null | undefined) {
  if (!url) return;

  try {
    if (url.startsWith('/uploads/')) {
      await deleteLocal(url.slice('/uploads/'.length));
      return;
    }
    if (url.includes('res.cloudinary.com')) {
      // .../upload/v1699999999/khatavala/<companyId>/<publicId>.jpg
      const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
      if (match) await deleteCloudinary(match[1]);
    }
  } catch (err) {
    logger.warn(`Could not delete image ${url}: ${err instanceof Error ? err.message : err}`);
  }
}

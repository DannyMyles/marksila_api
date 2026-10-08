import fs from 'fs';
import path from 'path';
import { Request } from 'express';
import multer from 'multer';
import { tenantOf } from './middleware/tenant';

/**
 * Uploaded files live under uploads/<app key>/<kind>/ — each app's files
 * are stored apart, and every lookup goes through the requesting tenant's
 * folder, so one app can never serve or delete another app's files.
 */
export const uploadsRoot = path.join(process.cwd(), 'uploads');

export type UploadKind = 'blogs' | 'testimonials' | 'events' | 'gallery' | 'products' | 'trainings';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/** Absolute directory holding this app's uploads of one kind (created on demand). */
export function uploadDir(req: Request, kind: UploadKind): string {
  const dir = path.join(uploadsRoot, tenantOf(req).key, kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path of a stored upload for this app; `filename` is a DB value. */
export function uploadPath(req: Request, kind: UploadKind, filename: string): string {
  return path.join(uploadsRoot, tenantOf(req).key, kind, path.basename(filename));
}

/** Public URL for a file served by the static /uploads route. */
export function uploadUrl(req: Request, kind: UploadKind, filename: string): string {
  return `/uploads/${tenantOf(req).key}/${kind}/${path.basename(filename)}`;
}

function createImageUploader(kind: UploadKind) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => cb(null, uploadDir(req, kind)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!file.mimetype.startsWith('image/') || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        cb(new Error('Only image uploads (.jpg, .jpeg, .png, .gif, .webp) are allowed'));
        return;
      }
      cb(null, true);
    },
  });
}

export const uploadBlogImage = createImageUploader('blogs');
export const uploadTestimonialPhoto = createImageUploader('testimonials');
export const uploadEventImage = createImageUploader('events');
export const uploadGalleryImages = createImageUploader('gallery');
export const uploadProductImages = createImageUploader('products');
export const uploadTrainingImage = createImageUploader('trainings');

/** Best-effort removal of a replaced/deleted upload (missing file is fine). */
export function removeUpload(req: Request, kind: UploadKind, filename: string | null | undefined) {
  if (!filename) return;
  fs.unlink(uploadPath(req, kind, filename), (err) => {
    if (err && err.code !== 'ENOENT') console.error(`[uploads] Failed to delete ${kind}/${filename}:`, err);
  });
}

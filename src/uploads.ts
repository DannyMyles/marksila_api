import fs from 'fs';
import path from 'path';
import multer from 'multer';

export const uploadsRoot = path.join(process.cwd(), 'uploads');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function createImageUploader(subdir: string) {
  const dir = path.join(uploadsRoot, subdir);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, unique);
    },
  });

  const uploader = multer({
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

  return { dir, uploader };
}

const blogUploads = createImageUploader('blogs');
export const blogsUploadDir = blogUploads.dir;
export const uploadBlogImage = blogUploads.uploader;

const testimonialUploads = createImageUploader('testimonials');
export const testimonialsUploadDir = testimonialUploads.dir;
export const uploadTestimonialPhoto = testimonialUploads.uploader;

const eventUploads = createImageUploader('events');
export const eventsUploadDir = eventUploads.dir;
export const uploadEventImage = eventUploads.uploader;

const galleryUploads = createImageUploader('gallery');
export const galleryUploadDir = galleryUploads.dir;
export const uploadGalleryImages = galleryUploads.uploader;

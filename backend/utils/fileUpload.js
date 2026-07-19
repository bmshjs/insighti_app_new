// File upload utilities
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/** server.js와 동일하게 upload 경로 해석 (절대경로면 그대로, 상대경로면 backend 기준) */
function resolveUploadDir() {
  const dir = config.upload.dir;
  if (path.isAbsolute(dir)) return dir;
  return path.join(__dirname, '..', dir.replace(/^\.\//, ''));
}

class FileUploadService {
  constructor() {
    this.uploadDir = resolveUploadDir();
    this.thumbDir = path.join(this.uploadDir, 'thumbs');
    this.ensureDirectories();
  }

  ensureDirectories() {
    // Create upload directories if they don't exist
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    if (!fs.existsSync(this.thumbDir)) {
      fs.mkdirSync(this.thumbDir, { recursive: true });
    }
  }

  generateFileName(originalName) {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    const uuid = uuidv4();
    return `${baseName}-${uuid}${ext}`;
  }

  createSharpInput(input) {
    if (Buffer.isBuffer(input)) {
      return sharp(input, { failOn: 'none' });
    }
    if (typeof input === 'string') {
      return sharp(input);
    }
    throw new Error('Invalid image input');
  }

  async processImage(input, options = {}) {
    const {
      width = 1200,
      height = 1200,
      quality = 80,
      skipIfFits = false,
    } = options;

    try {
      const sharpInput = this.createSharpInput(input);
      if (skipIfFits && Buffer.isBuffer(input)) {
        const meta = await sharpInput.metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (
          meta.format === 'jpeg' &&
          w > 0 && h > 0 &&
          w <= width && h <= height &&
          input.length <= 450 * 1024
        ) {
          return input;
        }
      }

      return await this.createSharpInput(input)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    } catch (error) {
      console.error('Image processing error:', error);
      throw new Error('Failed to process image');
    }
  }

  /** 본문+썸네일 병렬 생성 */
  async processImageWithThumbnail(input, options = {}) {
    const {
      width = 1200,
      height = 1200,
      quality = 78,
      thumbSize = 200,
    } = options;

    try {
      if (Buffer.isBuffer(input)) {
        const meta = await sharp(input, { failOn: 'none' }).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (
          meta.format === 'jpeg' &&
          w > 0 && h > 0 &&
          w <= width && h <= height &&
          input.length <= 450 * 1024
        ) {
          const thumbnailBuffer = await this.generateThumbnail(input, thumbSize);
          return { processedBuffer: input, thumbnailBuffer, skipped: true };
        }
      }

      const base = sharp(input, { failOn: 'none' });
      const [processedBuffer, thumbnailBuffer] = await Promise.all([
        base
          .clone()
          .resize(width, height, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer(),
        base
          .clone()
          .resize(thumbSize, thumbSize, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 65 })
          .toBuffer(),
      ]);
      return { processedBuffer, thumbnailBuffer, skipped: false };
    } catch (error) {
      console.error('Image process+thumb error:', error);
      throw new Error('Failed to process image');
    }
  }

  async generateThumbnail(input, size = 200) {
    try {
      const thumbnailBuffer = await this.createSharpInput(input)
        .resize(size, size, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 70 })
        .toBuffer();

      return thumbnailBuffer;
    } catch (error) {
      console.error('Thumbnail generation error:', error);
      throw new Error('Failed to generate thumbnail');
    }
  }

  async saveFile(buffer, fileName) {
    const filePath = path.join(this.uploadDir, fileName);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  }

  async saveThumbnail(buffer, fileName) {
    const thumbPath = path.join(this.thumbDir, `thumb-${fileName}`);
    await fs.promises.writeFile(thumbPath, buffer);
    return thumbPath;
  }

  getFileUrl(fileName) {
    return `/uploads/${fileName}`;
  }

  getThumbnailUrl(fileName) {
    return `/uploads/thumbs/thumb-${fileName}`;
  }

  async deleteFile(fileName) {
    try {
      const filePath = path.join(this.uploadDir, fileName);
      const thumbPath = path.join(this.thumbDir, `thumb-${fileName}`);
      
      // Delete original file
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      
      // Delete thumbnail
      if (fs.existsSync(thumbPath)) {
        await fs.promises.unlink(thumbPath);
      }
      
      return true;
    } catch (error) {
      console.error('File deletion error:', error);
      return false;
    }
  }

  validateFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSize = config.upload.maxFileSize; // 5MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
    }

    if (file.size > maxSize) {
      throw new Error(`File too large. Maximum size is ${maxSize / 1024 / 1024}MB.`);
    }

    return true;
  }
}

module.exports = new FileUploadService();

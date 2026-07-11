// Enhanced file upload routes
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');
const fileUploadService = require('../utils/fileUpload');
const { saveFileToStorage, loadFileFromStorage } = require('../utils/fileStorage');

const router = express.Router();

/** 업로드 디렉터리 해석 (server.js, fileUpload와 동일) */
function getUploadDir() {
  const dir = config.upload.dir;
  if (path.isAbsolute(dir)) return dir;
  return path.join(__dirname, '..', dir.replace(/^\.\//, ''));
}

/** GET /api/upload/serve/:filename - 이미지 서빙 (디스크 없으면 DB 백업) */
router.get('/serve/:filename', async (req, res) => {
  try {
    let filename = req.params.filename;
    if (!filename) return res.status(400).json({ error: 'Invalid filename' });
    try { filename = decodeURIComponent(filename); } catch (_) { /* keep as-is */ }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const uploadDir = getUploadDir();
    let filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
      const thumbPath = path.join(uploadDir, 'thumbs', `thumb-${filename}`);
      if (fs.existsSync(thumbPath)) {
        filePath = thumbPath;
      } else {
        const fromDb = await loadFileFromStorage(filename);
        if (fromDb) {
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Content-Type', fromDb.contentType);
          return res.send(fromDb.buffer);
        }
        const thumbDb = await loadFileFromStorage(`thumbs/thumb-${filename}`);
        if (thumbDb) {
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Content-Type', thumbDb.contentType);
          return res.send(thumbDb.buffer);
        }
        return res.status(404).json({ error: 'File not found' });
      }
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error('Upload serve error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for processing

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Get upload URL (for future use with cloud storage)
router.post('/url', authenticateToken, (req, res) => {
  try {
    const { type } = req.body;
    
    if (!type || !['near', 'far'].includes(type)) {
      return res.status(400).json({ error: 'Invalid photo type' });
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour expiry

    res.json({
      url: `/api/upload/photo`,
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Upload URL error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload and process photo
router.post('/photo', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file
    fileUploadService.validateFile(req.file);

    // Generate unique filename
    const fileName = fileUploadService.generateFileName(req.file.originalname);
    
    // Process image (resize, optimize)
    const processedBuffer = await fileUploadService.processImage(req.file.buffer, {
      width: 1200,
      height: 1200,
      quality: 85
    });

    // Generate thumbnail
    const thumbnailBuffer = await fileUploadService.generateThumbnail(req.file.buffer, 200);

    // Save files
    await fileUploadService.saveFile(processedBuffer, fileName);
    await fileUploadService.saveThumbnail(thumbnailBuffer, fileName);

    // DB 백업 — 재배포 후에도 사진·보고서에서 사용
    await saveFileToStorage(fileName, processedBuffer, 'image/jpeg');
    await saveFileToStorage(`thumbs/thumb-${fileName}`, thumbnailBuffer, 'image/jpeg');

    // Return file information
    res.json({
      key: fileName,
      url: fileUploadService.getFileUrl(fileName),
      thumbnail_url: fileUploadService.getThumbnailUrl(fileName),
      size: processedBuffer.length,
      original_size: req.file.size,
      mimetype: 'image/jpeg'
    });

  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete photo
router.delete('/photo/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const success = await fileUploadService.deleteFile(filename);
    
    if (success) {
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }

  } catch (error) {
    console.error('Photo deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get photo info
router.get('/photo/:filename', authenticateToken, (req, res) => {
  try {
    const { filename } = req.params;
    
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const fileUrl = fileUploadService.getFileUrl(filename);
    const thumbnailUrl = fileUploadService.getThumbnailUrl(filename);

    res.json({
      filename,
      url: fileUrl,
      thumbnail_url: thumbnailUrl
    });

  } catch (error) {
    console.error('Photo info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

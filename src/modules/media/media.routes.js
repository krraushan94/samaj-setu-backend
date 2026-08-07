const { Router } = require('express');
const { verifyToken } = require('../../middleware/auth');
const { asyncHandler } = require('../../middleware/errorHandler');
const { query } = require('../../config/db');
const { randomUUID: uuidv4 } = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

const router = Router();

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// Store files in memory before S3 upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|mov|mpeg|mp3|wav|aac|ogg|m4a|3gp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

router.post('/upload', verifyToken, upload.array('files', 5), asyncHandler(async (req, res) => {
  const { ticketId, type } = req.body;
  if (!req.files?.length) return res.status(400).json({ success: false, message: 'No files provided' });

  const uploaded = [];
  for (const file of req.files) {
    const key = `tickets/${ticketId}/${uuidv4()}-${file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }));
    const s3Url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    await query(
      'INSERT INTO media_attachments (id, ticket_id, type, s3_key, s3_url) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), ticketId, type || 'photo', key, s3Url]
    );
    uploaded.push({ key, url: s3Url });
  }
  res.json({ success: true, uploaded });
}));

module.exports = router;

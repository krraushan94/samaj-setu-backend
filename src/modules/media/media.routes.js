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

// The file extension and the client-supplied Content-Type header are both attacker-controlled
// (a request can declare "photo.jpg" with Content-Type: text/html) — so before trusting a file
// as media, sniff its actual bytes against known signatures for the types this app supports.
// Returns the real MIME type to store/serve, or null if the content doesn't match anything allowed.
const MAGIC_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { mime: 'image/png',  test: (b) => b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { mime: 'image/gif',  test: (b) => b.length >= 4 && b.slice(0, 4).toString('ascii') === 'GIF8' },
  // MP4/MOV/3GP/M4A all share the ISO base media 'ftyp' box at byte offset 4
  { mime: 'video/mp4',  test: (b) => b.length >= 12 && b.slice(4, 8).toString('ascii') === 'ftyp' },
  { mime: 'audio/wav',  test: (b) => b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WAVE' },
  { mime: 'audio/ogg',  test: (b) => b.length >= 4 && b.slice(0, 4).toString('ascii') === 'OggS' },
  // MP3: either an ID3v2 tag header, or a raw MPEG frame sync (11 set bits)
  { mime: 'audio/mpeg', test: (b) => b.length >= 3 && (b.slice(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) },
];
const detectMediaType = (buffer) => MAGIC_SIGNATURES.find((sig) => sig.test(buffer))?.mime || null;

router.post('/upload', verifyToken, upload.array('files', 5), asyncHandler(async (req, res) => {
  const { ticketId, type } = req.body;
  if (!req.files?.length) return res.status(400).json({ success: false, message: 'No files provided' });
  if (!ticketId) return res.status(400).json({ success: false, message: 'ticketId is required' });

  // Only the citizen who owns the ticket, or a team/admin member of its own department, may
  // attach media to it — previously ticketId was trusted straight from the request body, so
  // anyone logged in could plant files on (or spam) someone else's ticket.
  const ticketResult = await query('SELECT user_id, department_id FROM tickets WHERE id=$1', [ticketId]);
  if (!ticketResult.rows.length) return res.status(404).json({ success: false, message: 'Ticket not found' });
  const ticket = ticketResult.rows[0];
  const isOwner = req.user.role === 'citizen' && ticket.user_id === req.user.id;
  const isTeamOnDept = (req.user.role === 'leader' || req.user.role === 'member') && ticket.department_id === req.user.departmentId;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isTeamOnDept && !isAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorized to attach media to this ticket' });
  }

  const detectedTypes = req.files.map((file) => detectMediaType(file.buffer));
  const badFile = req.files.find((_file, i) => !detectedTypes[i]);
  if (badFile) {
    return res.status(400).json({ success: false, message: `"${badFile.originalname}" is not a recognized image/video/audio file` });
  }

  const uploaded = [];
  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    // Strip anything but safe filename characters — file.originalname is fully attacker-controlled.
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const key = `tickets/${ticketId}/${uuidv4()}-${safeName}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: detectedTypes[i],
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

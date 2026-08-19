const { mockQuery } = require('./helpers/dbMock');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/dbMock').dbMockFactory());

const mockS3Send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

const app = require('../src/app');
const { citizenToken, leaderToken, memberToken, adminToken, mockTicket } = require('./helpers/fixtures');

beforeEach(() => {
  mockQuery.mockReset();
  mockS3Send.mockClear();
});

// Real byte signatures for the file types media.routes.js recognizes.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF  = Buffer.from('GIF89a', 'ascii');
const MP4  = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // 'ftyp' at offset 4
const WAV  = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // RIFF....WAVE
const OGG  = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // OggS
const MP3_ID3   = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]); // ID3
const MP3_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x64]); // frame sync
const NOT_MEDIA = Buffer.from('<html><body>not a real media file</body></html>');

describe('POST /api/media/upload', () => {
  it('rejects with no files attached', async () => {
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no files/i);
  });

  it('rejects with no ticketId', async () => {
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ticketid/i);
  });

  it('returns 404 for a non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', 'no-such-ticket')
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(404);
  });

  it('blocks a citizen from attaching media to a ticket they do not own', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'someone-else', department_id: 'dept-uuid-1' }] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(403);
  });

  it('blocks a team member from a different department', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'OTHER-DEPT' }] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${memberToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(403);
  });

  it('rejects a file whose content does not match any recognized type', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', NOT_MEDIA, 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a recognized/i);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('rejects the whole batch if any one file fails content detection, even if others are valid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', JPEG, 'good.jpg')
      .attach('files', NOT_MEDIA, 'bad.jpg');
    expect(res.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('lets the owning citizen upload a valid JPEG', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // insert media_attachments
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id)
      .field('type', 'photo')
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(200);
    expect(res.body.uploaded).toHaveLength(1);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it('lets a leader in the same department upload', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${leaderToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', PNG, 'evidence.png');
    expect(res.status).toBe(200);
  });

  it('lets an admin upload regardless of department', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'SOME-OTHER-DEPT' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${adminToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', GIF, 'clip.gif');
    expect(res.status).toBe(200);
  });

  it('recognizes every supported media type by content, not extension', async () => {
    const cases = [
      { buf: MP4, name: 'video.mp4' },
      { buf: WAV, name: 'note.wav' },
      { buf: OGG, name: 'note.ogg' },
      { buf: MP3_ID3, name: 'song.mp3' },
      { buf: MP3_FRAME, name: 'song2.mp3' },
    ];
    for (const { buf, name } of cases) {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post('/api/media/upload')
        .set('Authorization', `Bearer ${citizenToken()}`)
        .field('ticketId', mockTicket.id)
        .attach('files', buf, name);
      expect(res.status).toBe(200);
    }
  });

  it('sanitizes unsafe characters out of the filename used in the S3 key', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', department_id: 'dept-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .field('ticketId', mockTicket.id)
      .attach('files', JPEG, '../../etc/passwd; rm -rf.jpg');
    expect(res.status).toBe(200);
    expect(res.body.uploaded[0].key).not.toMatch(/\.\.|\/etc\/|;/);
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app)
      .post('/api/media/upload')
      .field('ticketId', mockTicket.id)
      .attach('files', JPEG, 'photo.jpg');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/media/upload-photo', () => {
  it('rejects with no photo attached', async () => {
    const res = await request(app)
      .post('/api/media/upload-photo')
      .set('Authorization', `Bearer ${citizenToken()}`);
    expect(res.status).toBe(400);
  });

  it('rejects a non-image file', async () => {
    const res = await request(app)
      .post('/api/media/upload-photo')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .attach('photo', NOT_MEDIA, 'photo.jpg');
    expect(res.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('rejects a valid non-image media type (e.g. audio) — this endpoint is images only', async () => {
    const res = await request(app)
      .post('/api/media/upload-photo')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .attach('photo', MP3_ID3, 'clip.mp3');
    expect(res.status).toBe(400);
  });

  it('uploads a valid JPEG and returns its URL', async () => {
    const res = await request(app)
      .post('/api/media/upload-photo')
      .set('Authorization', `Bearer ${citizenToken()}`)
      .attach('photo', JPEG, 'photo.jpg');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\//);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it('returns 401 with no auth token', async () => {
    const res = await request(app)
      .post('/api/media/upload-photo')
      .attach('photo', JPEG, 'photo.jpg');
    expect(res.status).toBe(401);
  });
});

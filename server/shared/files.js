// Document uploads. Files are accepted only as PDF/JPEG/PNG (checked by their
// first bytes, not the name the uploader chose), stored under a server-generated
// name, hashed, and served only through the authenticated /api/v1/files route.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = [
  { ext: '.pdf', mime: 'application/pdf', magic: Buffer.from('%PDF-') },
  { ext: '.png', mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: '.jpg', mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
];
const FILE_URL_PREFIX = '/api/v1/files/';

class UploadError extends Error {}

function saveUpload(fileName, fileData) {
  const buf = Buffer.from(String(fileData).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buf.length) throw new UploadError('The file is empty');
  if (buf.length > MAX_BYTES) throw new UploadError('Files must be 10 MB or smaller');
  const kind = KINDS.find(k => buf.subarray(0, k.magic.length).equals(k.magic));
  if (!kind) throw new UploadError('Only PDF, JPEG or PNG files are accepted');
  const stored = `${crypto.randomUUID()}${kind.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  return {
    stored,
    file_url: FILE_URL_PREFIX + stored,
    file_name: String(fileName || `document${kind.ext}`).replace(/[\r\n"]/g, '').slice(0, 120),
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    mime: kind.mime,
  };
}

// Resolve a stored name to a path and type, refusing anything that is not one of our files.
function storedFile(name) {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(name)) return null;
  const full = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(full)) return null;
  return { full, mime: KINDS.find(k => name.endsWith(k.ext)).mime };
}

module.exports = { saveUpload, storedFile, UploadError, FILE_URL_PREFIX, UPLOAD_DIR };

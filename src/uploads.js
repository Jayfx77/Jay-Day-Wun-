const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');

// Detect real image type from magic bytes; never trust the client-supplied MIME type.
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function sniffDocument(buf) {
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  return sniffImage(buf);
}

const memory = (maxFiles) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxPhotoBytes, files: maxFiles, fields: 60 },
});

// Wraps multer so size/count errors become friendly form errors instead of 500s.
function parse(fieldName, maxFiles) {
  const handler = memory(maxFiles).array(fieldName, maxFiles);
  return (req, res, next) => handler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `Each file must be under ${Math.round(config.maxPhotoBytes / 1048576)} MB.`
        : `You can upload at most ${maxFiles} file(s) at once.`;
      req.files = [];
      req.body = req.body || {};
      return next();
    }
    next(err);
  });
}

function save(file, dir, sniff) {
  const ext = sniff(file.buffer);
  if (!ext) return null;
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return name;
}

const savePhoto = (file) => save(file, config.uploadDir, sniffImage);
const savePrivateDoc = (file) => save(file, config.privateDir, sniffDocument);

function removePhoto(filename) {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(filename)) return;
  fs.rm(path.join(config.uploadDir, filename), { force: true }, () => {});
}

module.exports = { parse, savePhoto, savePrivateDoc, removePhoto, sniffImage };

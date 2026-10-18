'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { AppError } = require('../utils/errors');

const DIR = path.join(config.root, 'data', 'uploads');
const MAX_BYTES = 1.5 * 1024 * 1024;
const URL_RE = /^\/uploads\/[a-f0-9]{16}\.(jpg|png|webp)$/;

function detect(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function getPhotoBucket() {
  if (process.env.CLOUDFLARE_WORKERS !== '1') return null;
  return require('./cloudflareBindings').getPhotos();
}

function contentType(ext) {
  return ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
}

async function saveImage(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) throw new AppError(400, 'Image invalide. Formats acceptés : JPEG, PNG ou WebP.', 'VALIDATION');

  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw new AppError(400, 'Image vide.', 'VALIDATION');
  if (buf.length > MAX_BYTES) throw new AppError(413, 'Image trop lourde (1,5 Mo maximum).', 'TOO_LARGE');

  const ext = detect(buf);
  if (!ext) throw new AppError(400, "Ce fichier n'est pas une image JPEG, PNG ou WebP valide.", 'VALIDATION');

  const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const bucket = getPhotoBucket();

  if (bucket) {
    await bucket.put(name, buf, {
      httpMetadata: { contentType: contentType(ext) }
    });
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, name), buf);
  }

  return `/uploads/${name}`;
}

async function removeImage(url) {
  if (!url || !URL_RE.test(url)) return;

  const name = path.basename(url);
  const bucket = getPhotoBucket();

  if (bucket) {
    await bucket.delete(name);
    return;
  }

  try {
    fs.unlinkSync(path.join(DIR, name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = { saveImage, removeImage, DIR, URL_RE, MAX_BYTES };

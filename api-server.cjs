#!/usr/bin/env node
/**
 * Snapshot & Screenshot API server (Express).
 *
 *   POST /api/snapshot     — upload image + metadata JSON sidecar to verification/
 *   POST /api/screenshot   — upload base64 PNG/JPEG, save to verification/ (legacy)
 *   GET  /api/screenshots  — list saved screenshots
 *   GET  /verification/*   — serve saved files (images + JSON sidecars)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8081', 10);
const VERIFICATION_DIR = path.join(__dirname, 'verification');

fs.mkdirSync(VERIFICATION_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '50mb' }));

// Serve saved screenshots
app.use('/verification', express.static(VERIFICATION_DIR));

// Upload snapshot (image + metadata JSON sidecar)
app.post('/api/snapshot', (req, res) => {
  let { image, label, format, metadata } = req.body || {};
  label = label || 'snapshot';
  format = format || 'png';
  image = image || '';
  metadata = metadata || {};

  // Strip data URI prefix
  if (image.includes(',')) {
    image = image.split(',')[1];
  }

  let raw;
  try {
    raw = Buffer.from(image, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 image data' });
  }

  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const id = `${ts}_${safeLabel}`;
  const imgFilename = `${id}.${format}`;
  const metaFilename = `${id}.json`;
  const imgPath = path.join(VERIFICATION_DIR, imgFilename);
  const metaPath = path.join(VERIFICATION_DIR, metaFilename);

  fs.writeFileSync(imgPath, raw);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  const result = {
    ok: true,
    id,
    filename: imgFilename,
    path: `/verification/${imgFilename}`,
    metadataPath: `/verification/${metaFilename}`,
    size: raw.length,
  };
  console.log(`[snapshot] saved ${id} (image: ${raw.length} bytes, metadata: ${metaFilename})`);
  res.status(201).json(result);
});

// Upload screenshot (legacy)
app.post('/api/screenshot', (req, res) => {
  let { image, label, format } = req.body || {};
  label = label || 'screenshot';
  format = format || 'png';
  image = image || '';

  // Strip data URI prefix
  if (image.includes(',')) {
    image = image.split(',')[1];
  }

  let raw;
  try {
    raw = Buffer.from(image, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 image data' });
  }

  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').replace(/(\d{8})(\d{6})/, '$1_$2');
  const filename = `${ts}_${safeLabel}.${format}`;
  const filepath = path.join(VERIFICATION_DIR, filename);

  fs.writeFileSync(filepath, raw);

  const result = {
    ok: true,
    filename,
    path: `/verification/${filename}`,
    size: raw.length,
  };
  console.log(`[screenshot] saved ${filename} (${raw.length} bytes)`);
  res.status(201).json(result);
});

// List screenshots
app.get('/api/screenshots', (req, res) => {
  const files = fs.readdirSync(VERIFICATION_DIR)
    .filter(n => /\.(png|jpg|jpeg)$/i.test(n))
    .sort()
    .map(name => {
      const full = path.join(VERIFICATION_DIR, name);
      const stat = fs.statSync(full);
      return {
        filename: name,
        path: `/verification/${name}`,
        size: stat.size,
        modified: stat.mtimeMs / 1000,
      };
    });
  res.json({ screenshots: files });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] Screenshot API on http://0.0.0.0:${PORT}`);
  console.log(`[api] Screenshots → ${VERIFICATION_DIR}`);
});

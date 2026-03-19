#!/usr/bin/env node
/**
 * Snapshot & Screenshot API server (Express).
 *
 *   POST /api/snapshot     — upload image + metadata JSON sidecar to verification/
 *   POST /api/screenshot   — upload base64 PNG/JPEG, save to verification/ (legacy)
 *   GET  /api/screenshots  — list saved screenshots
 *   GET  /verification/*   — serve saved files (images + JSON sidecars)
 *   GET  /verification/thumbs/* — on-demand thumbnail generation (360px wide JPEG)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PORT = parseInt(process.env.PORT || '8081', 10);
const VERIFICATION_DIR = path.join(__dirname, 'verification');
const THUMBS_DIR = path.join(VERIFICATION_DIR, 'thumbs');

fs.mkdirSync(VERIFICATION_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '50mb' }));

// On-demand thumbnail generation (cached)
app.get('/verification/thumbs/:filename', async (req, res) => {
  const { filename } = req.params;
  const thumbPath = path.join(THUMBS_DIR, filename.replace(/\.[^.]+$/, '.jpg'));
  const srcPath = path.join(VERIFICATION_DIR, filename);

  // Serve cached thumbnail
  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  // Generate from source
  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'Source image not found' });
  }

  try {
    await sharp(srcPath)
      .resize(360, null, { withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(thumbPath);
    res.sendFile(thumbPath);
  } catch (e) {
    console.warn(`[thumbs] failed to generate thumbnail for ${filename}:`, e.message);
    // Fall back to original
    res.sendFile(srcPath);
  }
});

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

// List snapshots with metadata (for Reference Browser)
app.get('/api/snapshots', (req, res) => {
  const files = fs.readdirSync(VERIFICATION_DIR)
    .filter(n => /\.(png|jpg|jpeg|webp)$/i.test(n))
    .sort()
    .reverse() // newest first
    .map(name => {
      const full = path.join(VERIFICATION_DIR, name);
      const stat = fs.statSync(full);
      const id = name.replace(/\.[^.]+$/, '');

      // Try to load JSON sidecar
      let metadata = null;
      const jsonPath = path.join(VERIFICATION_DIR, id + '.json');
      if (fs.existsSync(jsonPath)) {
        try { metadata = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
      }

      return {
        id,
        filename: name,
        path: `/verification/${name}`,
        thumbPath: `/verification/thumbs/${name}`,
        metadataPath: metadata ? `/verification/${id}.json` : null,
        size: stat.size,
        timestamp: metadata?.timestamp || new Date(stat.mtimeMs).toISOString(),
        label: id,
        metadata,
      };
    });
  res.json(files);
});

// List markdown docs (for Docs viewer)
app.get('/api/docs', (req, res) => {
  const DOCS_DIRS = [
    { dir: path.join(__dirname, 'docs'), section: 'docs' },
    { dir: path.join(__dirname, 'plans'), section: 'plans' },
  ];
  const files = [];
  for (const { dir, section } of DOCS_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter(n => /\.md$/i.test(n)).sort()) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      files.push({
        name,
        section,
        path: `/${section}/${name}`,
        size: stat.size,
        modified: stat.mtimeMs / 1000,
      });
    }
  }
  res.json(files);
});

// Serve markdown file content
app.get('/api/docs/content', (req, res) => {
  const filePath = req.query.file;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Missing file parameter' });
  }
  // Security: only allow docs/ and plans/ paths, no traversal
  const clean = filePath.replace(/\.\./g, '').replace(/^\//, '');
  if (!clean.startsWith('docs/') && !clean.startsWith('plans/')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const full = path.join(__dirname, clean);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.type('text/markdown').send(fs.readFileSync(full, 'utf8'));
});

// Serve docs/ and plans/ directories as static
app.use('/docs', express.static(path.join(__dirname, 'docs')));
app.use('/plans', express.static(path.join(__dirname, 'plans')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] Screenshot API on http://0.0.0.0:${PORT}`);
  console.log(`[api] Screenshots → ${VERIFICATION_DIR}`);
});

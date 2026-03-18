/**
 * Reference Browser — standalone page for browsing snapshots and uploads.
 *
 * Accessed via /references route.
 * Loads snapshot list from /api/snapshots and displays in a grid.
 * Supports: preview, metadata, copy discussion ref, compare mode.
 */

interface BrowserItem {
  id: string;
  type: 'snapshot' | 'upload';
  thumbUrl: string;
  fullUrl: string;
  metaUrl?: string;
  title: string;
  createdAt: string;
  tags: string[];
  notes: string;
  meta?: Record<string, unknown>;
}

// ── State ──
let items: BrowserItem[] = [];
let selectedId: string | null = null;
let compareId: string | null = null;
let filterType: 'all' | 'snapshot' | 'upload' = 'all';

// ── DOM ──
const app = document.getElementById('ref-app')!;

async function loadItems() {
  // Load snapshots from verification directory listing
  try {
    const resp = await fetch('/api/snapshots');
    if (resp.ok) {
      const list = await resp.json();
      items = list.map((s: any) => ({
        id: s.id || s.filename?.replace('.png', '') || 'unknown',
        type: s.metadata?.type === 'reference' ? 'upload' as const : 'snapshot' as const,
        thumbUrl: s.thumbPath || s.path || `/verification/${s.filename}`,
        fullUrl: s.path || `/verification/${s.filename}`,
        metaUrl: s.metadataPath || undefined,
        title: s.label || s.id || s.filename || 'Untitled',
        createdAt: s.timestamp || s.metadata?.timestamp || '',
        tags: extractTags(s),
        notes: '',
        meta: s.metadata,
      }));
    }
  } catch (e) {
    console.warn('[references] failed to load snapshots:', e);
  }

  render();
}

function extractTags(s: any): string[] {
  const tags: string[] = [];
  const m = s.metadata;
  if (!m) return tags;
  if (m.type === 'reference') tags.push('upload');
  if (m.reviewPreset) tags.push(m.reviewPreset);
  if (m.reviewView) tags.push(m.reviewView);
  if (m.clayMode) tags.push('clay');
  if (m.app?.presentationMode) tags.push('present');
  if (m.terrain?.coverageMode) tags.push(m.terrain.coverageMode);
  return tags;
}

function filteredItems(): BrowserItem[] {
  if (filterType === 'all') return items;
  return items.filter(i => i.type === filterType);
}

function getSelected(): BrowserItem | undefined {
  return items.find(i => i.id === selectedId);
}

function getCompare(): BrowserItem | undefined {
  return items.find(i => i.id === compareId);
}

// ── Copy Discussion Ref ──
function copyDiscussionRef(item: BrowserItem) {
  const origin = location.origin;
  const lines = [
    `**${item.title}** (${item.type})`,
    `Image: ${origin}${item.fullUrl}`,
    item.metaUrl ? `Metadata: ${origin}${item.metaUrl}` : '',
    item.tags.length ? `Tags: ${item.tags.join(', ')}` : '',
    item.createdAt ? `Created: ${item.createdAt}` : '',
  ].filter(Boolean).join('\n');

  navigator.clipboard.writeText(lines).then(() => {
    const btn = document.getElementById('copy-ref-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Discussion Ref'; }, 1500); }
  });
}

// ── Render ──
function render() {
  const selected = getSelected();
  const compare = getCompare();
  const filtered = filteredItems();

  app.innerHTML = `
    <div class="ref-layout">
      <div class="ref-sidebar">
        <h2>References</h2>
        <div class="ref-filters">
          <button class="ref-filter ${filterType === 'all' ? 'active' : ''}" data-filter="all">All (${items.length})</button>
          <button class="ref-filter ${filterType === 'snapshot' ? 'active' : ''}" data-filter="snapshot">Snapshots (${items.filter(i => i.type === 'snapshot').length})</button>
          <button class="ref-filter ${filterType === 'upload' ? 'active' : ''}" data-filter="upload">Uploads (${items.filter(i => i.type === 'upload').length})</button>
        </div>
        <a href="/" class="ref-back">← Back to Editor</a>
      </div>

      <div class="ref-grid">
        ${filtered.length === 0 ? '<div class="ref-empty">No items found</div>' : ''}
        ${filtered.map(item => `
          <div class="ref-thumb ${item.id === selectedId ? 'selected' : ''} ${item.id === compareId ? 'compare' : ''}"
               data-id="${item.id}">
            <img src="${item.thumbUrl}" loading="lazy" alt="${item.title}">
            <div class="ref-thumb-info">
              <span class="ref-badge ref-badge-${item.type}">${item.type}</span>
              <span class="ref-thumb-title">${item.title}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="ref-detail">
        ${selected ? `
          <div class="ref-preview">
            ${compare ? `
              <div class="ref-compare">
                <img src="${selected.fullUrl}" alt="${selected.title}">
                <img src="${compare.fullUrl}" alt="${compare.title}">
              </div>
            ` : `
              <img src="${selected.fullUrl}" alt="${selected.title}">
            `}
          </div>
          <div class="ref-meta">
            <h3>${selected.title}</h3>
            <div class="ref-meta-row"><span>Type:</span> <span class="ref-badge ref-badge-${selected.type}">${selected.type}</span></div>
            <div class="ref-meta-row"><span>ID:</span> <code>${selected.id}</code></div>
            ${selected.createdAt ? `<div class="ref-meta-row"><span>Created:</span> ${selected.createdAt}</div>` : ''}
            ${selected.tags.length ? `<div class="ref-meta-row"><span>Tags:</span> ${selected.tags.map(t => `<span class="ref-tag">${t}</span>`).join(' ')}</div>` : ''}
            <div class="ref-actions">
              <button id="copy-ref-btn" class="ref-action-btn" data-action="copy-ref">Copy Discussion Ref</button>
              <button class="ref-action-btn" data-action="copy-link">Copy Link</button>
              ${!compare ? `<button class="ref-action-btn" data-action="compare">Compare With...</button>` : `<button class="ref-action-btn" data-action="clear-compare">Clear Compare</button>`}
            </div>
            ${selected.metaUrl ? `<details><summary>Full Metadata</summary><pre class="ref-meta-json" id="meta-json">Loading...</pre></details>` : ''}
          </div>
        ` : `
          <div class="ref-detail-empty">Select an item to preview</div>
        `}
      </div>
    </div>
  `;

  // Wire events
  app.querySelectorAll('.ref-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      filterType = (btn as HTMLElement).dataset.filter as any;
      render();
    });
  });

  app.querySelectorAll('.ref-thumb').forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      if (compareId !== null) {
        // In compare selection mode
        compareId = id;
        render();
      } else {
        selectedId = id;
        compareId = null;
        render();
      }
    });
  });

  app.querySelectorAll('.ref-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = (btn as HTMLElement).dataset.action;
      if (action === 'copy-ref' && selected) copyDiscussionRef(selected);
      if (action === 'copy-link' && selected) {
        navigator.clipboard.writeText(`${location.origin}${selected.fullUrl}`);
        (btn as HTMLElement).textContent = 'Copied!';
        setTimeout(() => { (btn as HTMLElement).textContent = 'Copy Link'; }, 1500);
      }
      if (action === 'compare') {
        compareId = 'selecting'; // flag: next click picks compare item
        render();
      }
      if (action === 'clear-compare') {
        compareId = null;
        render();
      }
    });
  });

  // Load metadata if available
  if (selected?.metaUrl) {
    fetch(selected.metaUrl).then(r => r.json()).then(meta => {
      const el = document.getElementById('meta-json');
      if (el) el.textContent = JSON.stringify(meta, null, 2);
    }).catch(() => {});
  }
}

// ── Init ──
loadItems();

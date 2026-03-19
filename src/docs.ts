/**
 * Docs Viewer — browse and render project markdown documents in-app.
 *
 * Accessed via /docs route.
 * Loads file list from /api/docs and content from /api/docs/content.
 * Renders markdown to HTML with heading/list/code/blockquote support.
 */

interface DocFile {
  name: string;
  section: string;
  path: string;
  size: number;
  modified: number;
}

// ── State ──
let files: DocFile[] = [];
let selectedFile: string | null = null;
let filterText = '';

// ── DOM ──
const docsApp = document.getElementById('docs-app')!;

// ── Simple markdown → HTML renderer ──
function renderMarkdown(md: string): string {
  let html = '';
  const lines = md.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let inList = false;
  let listType = '';

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s: string): string {
    s = esc(s);
    // Bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/_(.+?)_/g, '<em>$1</em>');
    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }

  function closeList() {
    if (inList) {
      html += listType === 'ol' ? '</ol>' : '</ul>';
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code fences
    if (line.startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${esc(codeLines.join('\n'))}</code></pre>`;
        inCode = false;
        codeLines = [];
      } else {
        closeList();
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeList();
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html += `<h${level}>${inline(headingMatch[2])}</h${level}>`;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      html += '<hr>';
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      html += `<blockquote><p>${inline(line.slice(2))}</p></blockquote>`;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList();
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${inline(ulMatch[2])}</li>`;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${inline(olMatch[2])}</li>`;
      continue;
    }

    // Table row
    if (line.includes('|') && line.trim().startsWith('|')) {
      closeList();
      const cells = line.split('|').filter(c => c.trim() !== '');
      // Check if separator row
      if (cells.every(c => /^[\s-:]+$/.test(c))) continue;
      const isHeader = i + 1 < lines.length && lines[i + 1].includes('---');
      const tag = isHeader ? 'th' : 'td';
      html += '<table><tr>' + cells.map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('') + '</tr></table>';
      continue;
    }

    // Paragraph
    closeList();
    html += `<p>${inline(line)}</p>`;
  }

  closeList();
  if (inCode) {
    html += `<pre><code>${esc(codeLines.join('\n'))}</code></pre>`;
  }

  return html;
}

// ── Format file size ──
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}K`;
}

// ── Render ──
function renderDocs() {
  const filtered = files.filter(f =>
    !filterText || f.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const sections = new Map<string, DocFile[]>();
  for (const f of filtered) {
    if (!sections.has(f.section)) sections.set(f.section, []);
    sections.get(f.section)!.push(f);
  }

  docsApp.innerHTML = `
    <div class="docs-topbar">
      <span class="logo">VAST</span>
      <a href="/">Terrain</a>
      <a href="/references.html">References</a>
      <a href="/docs.html" class="active">Docs</a>
      <span class="spacer"></span>
      <span class="breadcrumb">${selectedFile ? selectedFile.replace(/^(docs|plans)\//, '') : 'Select a document'}</span>
    </div>
    <div class="docs-sidebar">
      <div class="docs-filter">
        <input type="text" placeholder="Filter docs..." value="${filterText}" id="doc-filter">
      </div>
      ${Array.from(sections.entries()).map(([section, sectionFiles]) => `
        <div class="section-label">${section}</div>
        ${sectionFiles.map(f => `
          <div class="doc-item ${selectedFile === f.path ? 'selected' : ''}"
               data-path="${f.path}">
            ${f.name.replace('.md', '')}
            <span class="doc-size">${formatSize(f.size)}</span>
          </div>
        `).join('')}
      `).join('')}
    </div>
    <div class="docs-content" id="doc-content">
      <div class="docs-empty">Select a document from the sidebar</div>
    </div>
  `;

  // Wire filter
  const filterInput = document.getElementById('doc-filter') as HTMLInputElement;
  filterInput?.addEventListener('input', () => {
    filterText = filterInput.value;
    renderDocs();
  });

  // Wire doc selection
  document.querySelectorAll('.doc-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = (el as HTMLElement).dataset.path;
      if (path) selectDoc(path);
    });
  });

  // Load selected doc content
  if (selectedFile) {
    loadDocContent(selectedFile);
  }
}

// ── Load and render a doc ──
async function loadDocContent(filePath: string) {
  const contentEl = document.getElementById('doc-content');
  if (!contentEl) return;

  contentEl.innerHTML = '<div class="docs-empty">Loading...</div>';

  try {
    const resp = await fetch(`/api/docs/content?file=${encodeURIComponent(filePath.replace(/^\//, ''))}`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const md = await resp.text();
    contentEl.innerHTML = `<div class="md">${renderMarkdown(md)}</div>`;
  } catch (err) {
    contentEl.innerHTML = `<div class="docs-empty">Failed to load: ${err}</div>`;
  }
}

function selectDoc(filePath: string) {
  selectedFile = filePath;
  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('file', filePath.replace(/^\//, ''));
  history.replaceState(null, '', url.toString());
  render();
}

// ── Init ──
async function init() {
  try {
    const resp = await fetch('/api/docs');
    files = await resp.json();
  } catch {
    files = [];
  }

  // Check URL for pre-selected file
  const params = new URLSearchParams(location.search);
  const fileParam = params.get('file');
  if (fileParam) {
    selectedFile = '/' + fileParam;
  } else if (files.length > 0) {
    // Default: first docs/ file (terrain-bake-pipeline-architecture.md)
    const defaultDoc = files.find(f => f.section === 'docs') || files[0];
    selectedFile = defaultDoc.path;
  }

  renderDocs();
}

init();

/**
 * Runtime error buffer — captures console.error, window.onerror,
 * and unhandled rejections into a capped ring buffer.
 * Does NOT swallow normal console/error behavior.
 */

export interface ErrorEntry {
  time: string;
  type: 'console.error' | 'onerror' | 'unhandledrejection';
  message: string;
  stack?: string;
}

const MAX_ENTRIES = 50;
const entries: ErrorEntry[] = [];

function push(entry: ErrorEntry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

function now(): string {
  return new Date().toISOString();
}

// Patch console.error — preserve original behavior
const _origError = console.error;
console.error = (...args: unknown[]) => {
  _origError.apply(console, args);
  push({
    time: now(),
    type: 'console.error',
    message: args.map(a => (a instanceof Error ? a.message : String(a))).join(' '),
    stack: args.find(a => a instanceof Error)?.stack,
  });
};

// Global error handler
window.addEventListener('error', (e) => {
  push({
    time: now(),
    type: 'onerror',
    message: e.message || String(e.error),
    stack: e.error?.stack,
  });
});

// Unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  push({
    time: now(),
    type: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

/** Return a copy of recent error entries. */
export function getRecentErrors(): ErrorEntry[] {
  return entries.slice();
}

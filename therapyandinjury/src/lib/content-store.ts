// Loads the content editor's file (content.json in the app root; path given by the server in
// TI_CONTENT_FILE) into the live data in site.ts. Called on every request by src/middleware.ts;
// the file is only re-read when it changes. Without the file (local dev, build), the defaults in
// src/data/*.json are used.
import { readFileSync, statSync } from 'node:fs';
import { applyContent, site, branches } from './site';

let loadedMtime = -1;

export function refreshContent() {
  const file = process.env.TI_CONTENT_FILE;
  if (!file) return;
  let mtime = 0;
  try { mtime = statSync(file).mtimeMs; } catch { mtime = 0; }
  if (mtime === loadedMtime) return;
  loadedMtime = mtime;
  if (!mtime) return applyContent(null);
  try {
    applyContent(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    // A broken file never takes the site down: keep the defaults and say why in the log.
    console.error('[content] could not read content.json; using defaults:', (e as Error).message);
    applyContent(null);
  }
}

// The deploy server (deploy/server, CommonJS) reads the live data through this handle: each location's
// email routes its form requests, and its domains drive the city-domain redirects.
(globalThis as Record<string, unknown>).__therapyandinjury = { refresh: refreshContent, site, branches };

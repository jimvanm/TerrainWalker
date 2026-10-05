// Persistent tile cache. Works from the main thread and from workers.
//
// It saves the RAW downloads (elevation PNGs and vector tiles), never the
// meshes we build from them. Raw tiles are small, and keeping them means a
// later improvement to our own code still applies to places you have visited.
//
// Uses the browser's Cache API. It lives in this site's own storage, so it
// is cleared by private windows and by "clear site data", and it only works
// on https or localhost. Any failure falls back to a plain download.

import { CACHE_ON, CACHE_MAX_ENTRIES, CACHE_MAX_DAYS } from './config.js';

const NAME = 'tw-tiles-v1';
const STAMP = 'x-tw-time';
const MAX_AGE = CACHE_MAX_DAYS * 864e5;

let opening = null;
function open() {
  if (!CACHE_ON || typeof caches === 'undefined') return Promise.resolve(null);
  if (!opening) opening = caches.open(NAME).catch(() => null);
  return opening;
}

// Same as fetch(url, init), but served from the cache when we have it and it
// is fresh. If the network fails and we hold an old copy, the old copy wins.
export async function cachedFetch(url, init) {
  // This site's own files (a place's tiles) are never kept: they are local,
  // and rebuilding them must show at once.
  if (typeof location !== 'undefined' && new URL(url, location.href).origin === location.origin) {
    return fetch(url, { ...init, cache: 'no-cache' });
  }
  const cache = await open();
  let stale = null;
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const t = Number(hit.headers.get(STAMP)) || 0;
        if (Date.now() - t < MAX_AGE) return hit;
        stale = hit;
      }
    } catch (e) { /* fall through to the network */ }
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (stale) return stale;
    throw e;
  }
  if (res.status === 200 && cache) {
    try {
      // Only the content type is carried over: the body we hold is already
      // decoded, so copying a content-encoding header would corrupt it.
      const headers = new Headers();
      headers.set('content-type', res.headers.get('content-type') || 'application/octet-stream');
      headers.set(STAMP, String(Date.now()));
      cache.put(url, new Response(res.clone().body, { status: 200, headers })).catch(() => {});
    } catch (e) { /* caching is a bonus, never a requirement */ }
  }
  return res;
}

// Main thread only. Keeps the entry count under the cap, oldest first, and asks
// the browser not to discard the cache when disk space gets tight.
export async function startCache() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) { /* ignore */ }
  const cache = await open();
  if (!cache) return;
  try {
    const keys = await cache.keys();       // oldest first
    for (let i = 0; i < keys.length - CACHE_MAX_ENTRIES; i++) await cache.delete(keys[i]);
  } catch (e) { /* ignore */ }
}

// { mb, persistent } or null when the browser will not say.
export async function cacheUsage() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { mb: (e.usage || 0) / 1048576, persistent };
  } catch (e) { return null; }
}

export async function clearCache() {
  try { opening = null; return await caches.delete(NAME); } catch (e) { return false; }
}

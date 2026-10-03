/**
 * dsh-icpc-boot — host half.
 *
 * Two jobs, and nothing else.
 *
 * 1. Contribute index rows to every HTML response the web carrier serves: an
 *    opaque cover that hides the DSH boot card, and a tiny synchronous script
 *    that raises it while <head> is still being parsed. The cover is retired by
 *    the browser half the moment its own first video frame is on screen — the
 *    rows exist only to remove the gap between "HTML arrived" and "the client
 *    bundle booted", which is where the unthemed boot card would otherwise be
 *    visible.
 *
 * 2. Serve the two ICPC clips out of `assets/` over HTTP. The videos are not
 *    bundled into the client module — a 300 KB binary in a JS string would be
 *    parsed on every boot — they are streamed from here with Range support so
 *    the browser starts decoding before the whole file has arrived.
 *
 * The rows are contributed through a plain composition event, not an injected
 * service, so a profile without an HTTP carrier still gets a splash; only the
 * asset routes disappear (and the browser half then retires its cover on the
 * video error, which is the same path a missing file takes).
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Cordis plugin name; the browser half registers under the same one. */
export const name = 'icpc-boot'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const ASSET_DIR = join(PACKAGE_ROOT, 'assets')

const PACKAGE_NAME = 'dsh-icpc-boot'
const ROUTE_BASE = '/dsh-icpc-boot'

/** localStorage key shared with the browser half. */
const MODE_KEY = 'dsh-icpc-boot:mode'
/** Valid modes; `off` means "do not cover, do not play". */
const MODES = Object.freeze(['intro', 'neon', 'off'])
const DEFAULT_MODE = 'intro'

const FIRST_FRAME_GLOBAL = '__dshIcpcFirstFrame'
const VERSION_GLOBAL = '__dshIcpcBootVersion'

/**
 * Above the boot card and above every surface the shell can raise. The cover is
 * pointer-events:none, so being first in the stack costs nothing.
 */
const FIRST_FRAME_Z = 2147483000
/** How long the cover may survive without the browser half retiring it. */
const FIRST_FRAME_MAX_MS = 8000

/**
 * The colour behind the video, per mode. `intro` opens on a black frame, so a
 * black cover hands over with no seam at all. `neon` opens on the render's own
 * vignette — reproduced here as the same radial falloff so the cover, the
 * pre-decode video surface and the first decoded frame all agree.
 */
const BACKGROUNDS = Object.freeze({
  intro: '#000',
  neon:
    'radial-gradient(ellipse 72.9% 74.1% at 50% 46.3%,' +
    '#0a122c 0%,#050916 25%,#020308 50%,#000 75%)',
})

/** The clips this plugin ships, mapped to the route that serves them. */
const ASSETS = Object.freeze([
  {
    mode: 'intro',
    path: `${ROUTE_BASE}/assets/icpc-intro.mp4`,
    file: 'icpc-intro.mp4',
    type: 'video/mp4',
  },
  {
    mode: 'neon',
    path: `${ROUTE_BASE}/assets/icpc-neon.mp4`,
    file: 'icpc-neon.mp4',
    type: 'video/mp4',
  },
])

const META_PATH = `${ROUTE_BASE}/meta.json`

function readVersion() {
  try {
    const parsed = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

const VERSION = readVersion()

const FIRST_FRAME_CSS =
  'html.dshicpc-first{background:' +
  BACKGROUNDS.intro +
  '}\n' +
  'html.dshicpc-first::before{content:"";position:fixed;inset:0;background:' +
  BACKGROUNDS.intro +
  ';z-index:' +
  String(FIRST_FRAME_Z) +
  ';pointer-events:none}\n' +
  'html.dshicpc-first[data-dsh-icpc-mode="neon"]{background:#000}\n' +
  'html.dshicpc-first[data-dsh-icpc-mode="neon"]::before{background:' +
  BACKGROUNDS.neon +
  '}\n'

/**
 * The class marker, the handshake and the two retirements.
 *
 * Deliberately tiny and synchronous: it runs while <head> is being parsed, so
 * the cover is painted before anything else is. It exposes `end()` on a global
 * so the browser half can lower the cover the instant its splash is on screen,
 * and it watches the boot card as a second retirement path: the kernel removes
 * the card exactly when the application mounts, and the card drops its spinner
 * when it renders its own error state — a broken page has to stay readable
 * rather than be hidden behind a cover forever. The timeout is the last resort
 * for a card that never appears at all.
 */
const FIRST_FRAME_SCRIPT =
  '(function(){' +
  'var mode=null;' +
  'try{mode=window.localStorage.getItem(' +
  JSON.stringify(MODE_KEY) +
  ')}catch(error){}' +
  'if(mode==="off")return;' +
  'if(mode!=="neon")mode="intro";' +
  'var root=document.documentElement;' +
  'root.setAttribute("data-dsh-icpc-mode",mode);' +
  'var stopped=false;' +
  'var watch=null;' +
  'var end=function(){' +
  'if(stopped)return;' +
  'stopped=true;' +
  'if(watch!==null){window.clearInterval(watch);watch=null}' +
  'root.classList.remove("dshicpc-first")' +
  '};' +
  'window.' +
  FIRST_FRAME_GLOBAL +
  '={end:end,mode:mode};' +
  'root.classList.add("dshicpc-first");' +
  'var seen=false;' +
  'watch=window.setInterval(function(){' +
  'var card=document.querySelector("[data-dsh-boot]");' +
  'if(card===null){if(seen)end();return}' +
  'seen=true;' +
  'if(card.querySelector("[data-dsh-boot-spinner]")===null)end()' +
  '},250);' +
  'window.setTimeout(end,' +
  String(FIRST_FRAME_MAX_MS) +
  ');' +
  '})()'

// ---------------------------------------------------------------------------
// Asset serving
// ---------------------------------------------------------------------------

/** Whole-file buffers, read once. The largest clip is under half a megabyte. */
const assetCache = new Map()

function loadAsset(asset) {
  let pending = assetCache.get(asset.file)
  if (pending === undefined) {
    pending = readFile(join(ASSET_DIR, asset.file))
    assetCache.set(asset.file, pending)
    pending.catch(() => assetCache.delete(asset.file))
  }
  return pending
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Parses a single-range `Range` header.
 *
 * @returns `null` when there is no range (serve the whole thing), the string
 *   `'invalid'` when the header cannot be satisfied (416), or `{start,end}`.
 */
function parseRange(header, total) {
  if (typeof header !== 'string' || header.length === 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return 'invalid'
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }
  const start = Number(rawStart)
  const end = rawEnd === '' ? total - 1 : Number(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
  if (start > end || start >= total) return 'invalid'
  return { start, end: Math.min(end, total - 1) }
}

async function assetHandler(asset, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  let body
  try {
    body = await loadAsset(asset)
  } catch (caught) {
    sendJson(res, 404, {
      ok: false,
      error: `missing asset ${asset.file}`,
      detail: caught instanceof Error ? caught.message : String(caught),
      hint: 'Reinstall dsh-icpc-boot; the assets/ directory ships with the package.',
    })
    return
  }
  const total = body.length
  const base = {
    'content-type': asset.type,
    'cache-control': 'public, max-age=86400',
    'accept-ranges': 'bytes',
  }
  const range = parseRange(req.headers?.range, total)
  if (range === null) {
    res.writeHead(200, { ...base, 'content-length': String(total) })
    res.end(req.method === 'HEAD' ? undefined : body)
    return
  }
  if (range === 'invalid') {
    res.writeHead(416, { ...base, 'content-range': `bytes */${total}` })
    res.end()
    return
  }
  const chunk = body.subarray(range.start, range.end + 1)
  res.writeHead(206, {
    ...base,
    'content-range': `bytes ${range.start}-${range.end}/${total}`,
    'content-length': String(chunk.length),
  })
  res.end(req.method === 'HEAD' ? undefined : chunk)
}

/**
 * Describes the plugin to its own browser half and to anything else that wants
 * to know which clips are on offer. Reads nothing the caller cannot already
 * guess; it exists so the settings row and a future port both have one place to
 * ask instead of hard-coding filenames twice.
 */
function metaHandler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  sendJson(res, 200, {
    ok: true,
    package: PACKAGE_NAME,
    version: VERSION,
    modeKey: MODE_KEY,
    modes: MODES,
    defaultMode: DEFAULT_MODE,
    backgrounds: BACKGROUNDS,
    clips: ASSETS.map((asset) => ({ mode: asset.mode, path: asset.path, type: asset.type })),
  })
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return
    table.push({ kind: 'style', text: FIRST_FRAME_CSS })
    table.push({ kind: 'script', placement: 'head', text: FIRST_FRAME_SCRIPT })
    // Ahead of the script rows: the settings row reads its own version from
    // here rather than asking the host for something it can already know.
    if (VERSION !== null) table.push({ kind: 'global', name: VERSION_GLOBAL, value: VERSION })
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: META_PATH,
          handler: metaHandler,
        }),
      `${name}: GET ${META_PATH}`,
    )
    for (const asset of ASSETS) {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path: asset.path,
            handler: (req, res) => assetHandler(asset, req, res),
          }),
        `${name}: GET ${asset.path}`,
      )
    }
  })
}

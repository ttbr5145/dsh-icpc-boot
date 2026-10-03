/**
 * End-to-end check for dsh-icpc-boot against a REAL DSH web app.
 *
 * Why this exists next to scripts/verify.mjs: verify.mjs is a synthetic
 * harness — it stubs `__ModuleLoader__` and pushes the first-frame rows into a
 * blank page by hand. That proves the two halves are correct in isolation, but
 * it never proves that DSH itself discovers the bundle, applies the patch
 * layer, serves the mp4 routes, or evaluates the browser half with its own
 * loader. This script proves exactly those four things, with nothing stubbed.
 *
 * How it stays out of the way of a running DSH: it provisions a throwaway
 * DSH_HOME under the temp directory, containing a single profile whose bundle
 * list is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `dsh-icpc-boot`.
 * That profile borrows the installed package tree through a `node_modules`
 * junction and links this package in place, so no install and no network are
 * involved, and the user's own profile, storage and sessions are never touched.
 * The child process is killed and the temp home removed on the way out.
 *
 *   node scripts/e2e.mjs                 # provision, boot, check, tear down
 *   DSH_E2E_URL=http://... node scripts/e2e.mjs   # check an already-booted app
 *   ICPC_E2E_KEEP=1 node scripts/e2e.mjs  # keep the temp home for inspection
 *
 * Requirements: `dsh` on PATH (override with DSH_BIN), and the same Chrome and
 * puppeteer-core that verify.mjs needs.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const PROFILE_NAME = 'icpc-e2e'
const E2E_HOME = process.env.ICPC_E2E_HOME ?? join(tmpdir(), 'dsh-icpc-boot-e2e')
const DSH_BIN = process.env.DSH_BIN ?? 'dsh'
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SHARED_MODULES = join(DSH_HOME, 'profiles', 'node_modules')
const PROFILE_MODULES = process.env.DSH_PROFILE_MODULES ?? join(DSH_HOME, 'profiles', 'desktop')

const CHROME_CANDIDATES = [
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]

const checks = []
function check(label, ok, detail) {
	checks.push({ label, ok, detail })
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  [${detail}]`}`)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Writes the throwaway profile. Returns the profile directory so the caller can
 * hand it to the child process as `DSH_HOME`.
 */
function provisionProfile() {
	if (!existsSync(SHARED_MODULES)) {
		throw new Error(
			`cannot find the installed package tree at ${SHARED_MODULES}. ` +
				`Point DSH_HOME at the harness home that has profiles/node_modules, or set DSH_E2E_URL ` +
				`to an already-running app and skip provisioning.`
		)
	}
	rmSync(E2E_HOME, { recursive: true, force: true })
	const profilesDir = join(E2E_HOME, 'profiles')
	const profileDir = join(profilesDir, PROFILE_NAME)
	mkdirSync(join(profileDir, 'node_modules'), { recursive: true })

	// The shipped base/web-app bundles live in the shared tree one level up, so
	// mirror that layout instead of copying it.
	symlinkSync(SHARED_MODULES, join(profilesDir, 'node_modules'), 'junction')
	symlinkSync(PACKAGE_ROOT, join(profileDir, 'node_modules', 'dsh-icpc-boot'), 'junction')

	writeFileSync(
		join(profileDir, 'package.json'),
		JSON.stringify(
			{
				name: `dsh-profile-${PROFILE_NAME}`,
				private: true,
				dependencies: { 'dsh-icpc-boot': `link:${PACKAGE_ROOT.replace(/\\/g, '/')}` },
				dsh: {
					profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-icpc-boot'] }
				}
			},
			null,
			'\t'
		) + '\n'
	)
	writeFileSync(join(profileDir, 'cordis.yml'), '# throwaway e2e profile root: no user entries\n[]\n')
	writeFileSync(
		join(profileDir, 'cordis.patch.yml'),
		'# Deliberately empty: the point is to observe the plugin`s own bundle layer.\n[]\n'
	)
	writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
	return profileDir
}

/**
 * Boots `dsh <profile> --port 0 --no-open` and resolves with the tokenised URL
 * the CLI prints. Rejects if the CLI never prints one.
 */
function bootApp() {
	return new Promise((resolve, reject) => {
		const child = spawn(DSH_BIN, [PROFILE_NAME, '--port', '0', '--no-open'], {
			cwd: E2E_HOME,
			env: { ...process.env, DSH_HOME: E2E_HOME },
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe']
		})
		let output = ''
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			reject(new Error(`timed out waiting for the app to print its URL.\n${output.slice(-2000)}`))
		}, 120000)
		const scan = (chunk) => {
			output += String(chunk)
			const found = output.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)
			if (found !== null && !settled) {
				settled = true
				clearTimeout(timer)
				resolve({ child, url: found[0] })
			}
		}
		child.stdout.on('data', scan)
		child.stderr.on('data', scan)
		child.on('exit', (code) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(new Error(`the app exited with code ${code} before printing a URL.\n${output.slice(-2000)}`))
		})
	})
}

function killApp(child) {
	if (child === undefined || child.pid === undefined) return
	if (process.platform === 'win32') {
		try {
			spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
		} catch {
			child.kill('SIGKILL')
		}
	} else {
		child.kill('SIGTERM')
	}
}

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (chrome === undefined) throw new Error('no Chrome/Edge binary found')
const puppeteer = createRequire(join(PROFILE_MODULES, 'noop.js'))('puppeteer-core')

let child
let target = process.env.DSH_E2E_URL
try {
	if (target === undefined || target === '') {
		provisionProfile()
		console.log(`booting a throwaway DSH home at ${E2E_HOME}\n  (the running app, its profile and its sessions are untouched)\n`)
		const booted = await bootApp()
		child = booted.child
		target = booted.url
	}
} catch (error) {
	killApp(child)
	console.error(String(error.message ?? error))
	process.exitCode = 1
}

if (target !== undefined && target !== '') {
	const origin = new URL(target).origin
	console.log(`target: ${origin}\n`)

	// ------------------------------------------------------------ host routes
	console.log('[1/3] host routes served by the real web server')
	const CLIP_PATH = '/dsh-icpc-boot/assets/icpc-intro.mp4'
	const NEON_PATH = '/dsh-icpc-boot/assets/icpc-neon.mp4'
	const meta = await fetch(`${origin}/dsh-icpc-boot/meta.json`)
	check('GET /dsh-icpc-boot/meta.json -> 200', meta.status === 200, String(meta.status))
	const metaBody = await meta.json().catch(() => null)
	check(
		'meta lists both clips and the default mode',
		metaBody !== null && Array.isArray(metaBody.clips) && metaBody.clips.length === 2 && metaBody.defaultMode === 'intro',
		metaBody === null ? 'unparsable' : `clips=${metaBody.clips.map((c) => c.mode).join('/')} default=${metaBody.defaultMode}`
	)

	const clip = await fetch(`${origin}${CLIP_PATH}`, { method: 'HEAD' })
	check(`HEAD ${CLIP_PATH} -> 200`, clip.status === 200, String(clip.status))
	check('mp4 content-type is video/mp4', (clip.headers.get('content-type') ?? '').includes('video/mp4'),
		clip.headers.get('content-type') ?? 'absent')
	check('mp4 content-length matches the asset on disk',
		clip.headers.get('content-length') === String(readFileSync(join(PACKAGE_ROOT, 'assets', 'icpc-intro.mp4')).byteLength),
		clip.headers.get('content-length') ?? 'absent')
	check('accept-ranges: bytes advertised', clip.headers.get('accept-ranges') === 'bytes',
		clip.headers.get('accept-ranges') ?? 'absent')

	const ranged = await fetch(`${origin}${CLIP_PATH}`, { headers: { Range: 'bytes=100-199' } })
	const rangedBody = Buffer.from(await ranged.arrayBuffer())
	check('Range request -> 206', ranged.status === 206, String(ranged.status))
	check('Range returns exactly 100 bytes', rangedBody.byteLength === 100, `${rangedBody.byteLength} bytes`)
	check('content-range echoes the requested window',
		/^bytes 100-199\/\d+$/.test(ranged.headers.get('content-range') ?? ''),
		ranged.headers.get('content-range') ?? 'absent')
	check('the two clips are distinct assets',
		(await fetch(`${origin}${NEON_PATH}`, { method: 'HEAD' })).headers.get('content-length') !==
			clip.headers.get('content-length'))

	// -------------------------------------------------------------- the page
	console.log('\n[2/3] the boot sequence inside the real app shell')
	const browser = await puppeteer.launch({
		executablePath: chrome,
		headless: true,
		args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required']
	})
	try {
		const page = await browser.newPage()
		const pageErrors = []
		const consoleErrors = []
		page.on('pageerror', (error) => pageErrors.push(`${error}\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}`))
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text())
		})

		// Record the first paints before the app's own code runs. Note that this
		// runs before <html> necessarily exists, hence the null guard.
		await page.evaluateOnNewDocument(() => {
			window.__icpcE2e = { coverAtStart: null, coverRetiredAt: null, t0: Date.now() }
			const record = () => {
				if (document.documentElement === null) return
				const covered = document.documentElement.classList.contains('dshicpc-first')
				if (covered && window.__icpcE2e.coverAtStart === null) {
					window.__icpcE2e.coverAtStart = Date.now() - window.__icpcE2e.t0
				}
				if (!covered && window.__icpcE2e.coverAtStart !== null && window.__icpcE2e.coverRetiredAt === null) {
					window.__icpcE2e.coverRetiredAt = Date.now() - window.__icpcE2e.t0
				}
			}
			const observer = new MutationObserver(record)
			document.addEventListener('DOMContentLoaded', () => {
				observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
				record()
			})
			record()
		})

		await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 })
		await page.waitForFunction('typeof window.__ModuleLoader__ === "object" && window.__ModuleLoader__ !== null', {
			timeout: 60000
		})
		check('real app shell booted (window.__ModuleLoader__ present)', true)

		const injected = await page.evaluate(() => ({
			global: typeof window.__dshIcpcFirstFrame,
			version: window.__dshIcpcBootVersion ?? null,
			styleTag: [...document.querySelectorAll('style')].some((node) => node.textContent.includes('dshicpc-first')),
			scriptTag: [...document.querySelectorAll('script')].some((node) => node.textContent.includes('__dshIcpcFirstFrame'))
		}))
		check('host half injected the first-frame CSS', injected.styleTag === true)
		check('host half injected the first-frame script', injected.scriptTag === true)
		check('first-frame global is exposed by the injected script', injected.global === 'object', injected.global)
		check('version global reached the page', typeof injected.version === 'string' && injected.version.length > 0,
			String(injected.version))

		await page.waitForFunction('document.getElementById("dsh-icpc-boot-stage") !== null', { timeout: 30000 })
		check('browser half mounted its stage in the real app', true)

		// The stage appears before the media decodes, so wait for metadata
		// rather than racing it.
		await page.waitForFunction(
			'document.getElementById("dsh-icpc-boot-stage").shadowRoot.querySelector("video").readyState >= 1',
			{ timeout: 30000 }
		)
		check('clip metadata loaded from the plugin route', true)

		const stage = await page.evaluate(() => {
			const host = document.getElementById('dsh-icpc-boot-stage')
			const video = host.shadowRoot.querySelector('video')
			return {
				shadowPresent: host.shadowRoot !== null,
				src: video.getAttribute('src'),
				videoWidth: video.videoWidth,
				videoHeight: video.videoHeight,
				duration: video.duration,
				errorCode: video.error === null ? null : video.error.code,
				coverStillUp: document.documentElement.classList.contains('dshicpc-first'),
				fading: host.classList.contains('is-out')
			}
		})
		console.log(`      ${JSON.stringify(stage)}`)
		check('stage host owns an open shadow root', stage.shadowPresent === true)
		check('clip is the intro asset served by the plugin route', stage.src === CLIP_PATH, String(stage.src))
		check('clip decoded as 1920x1080', stage.videoWidth === 1920 && stage.videoHeight === 1080,
			`${stage.videoWidth}x${stage.videoHeight}`)
		check('clip duration is ~5s', Math.abs(stage.duration - 5) < 0.25, String(stage.duration))
		check('clip has no media error', stage.errorCode === null, String(stage.errorCode))
		check('cover handed over to the browser half', stage.coverStillUp === false)

		await delay(1500)
		const playing = await page.evaluate(() => {
			const video = document.getElementById('dsh-icpc-boot-stage').shadowRoot.querySelector('video')
			return { currentTime: video.currentTime, paused: video.paused }
		})
		check('clip advances in real time', playing.currentTime > 0.8, `t=${playing.currentTime.toFixed(2)}`)
		check('clip is not paused', playing.paused === false)

		// This box has no vision model, so measure pixels instead of looking.
		const sampleAt = (time, label) =>
			page.evaluate(
				async (time) => {
					const video = document.getElementById('dsh-icpc-boot-stage').shadowRoot.querySelector('video')
					const wasPlaying = !video.paused
					video.pause()
					await new Promise((resolve) => {
						const done = () => {
							video.removeEventListener('seeked', done)
							resolve()
						}
						video.addEventListener('seeked', done)
						video.currentTime = time
					})
					const canvas = document.createElement('canvas')
					canvas.width = 320
					canvas.height = 180
					const context = canvas.getContext('2d')
					context.drawImage(video, 0, 0, canvas.width, canvas.height)
					const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
					let lit = 0
					let saturated = 0
					let luma = 0
					const total = data.length / 4
					for (let index = 0; index < data.length; index += 4) {
						const r = data[index]
						const g = data[index + 1]
						const b = data[index + 2]
						if (Math.max(r, g, b) > 24) lit += 1
						if (Math.max(r, g, b) - Math.min(r, g, b) > 40) saturated += 1
						luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
					}
					if (wasPlaying) void video.play()
					return { lit: lit / total, saturated: saturated / total, luma: luma / total }
				},
				time
			)
		const show = (label, sample) =>
			console.log(
				`      ${label} lit=${sample.lit.toFixed(4)} saturated=${sample.saturated.toFixed(4)} luma=${sample.luma.toFixed(4)}`
			)

		const atStart = await sampleAt(0)
		const atLogo = await sampleAt(3.6)
		show('t=0  ', atStart)
		show('t=3.6', atLogo)
		check('first frame is black, so the injected cover needs no poster', atStart.lit < 0.005, atStart.lit.toFixed(4))
		check('logo frame is drawn from the real mp4 over the real route', atLogo.lit > 0.03, atLogo.lit.toFixed(4))
		check('logo frame is saturated (the ICPC mark)', atLogo.saturated / Math.max(atLogo.lit, 1e-6) > 0.5,
			(atLogo.saturated / Math.max(atLogo.lit, 1e-6)).toFixed(4))

		// The cover must retire because the browser half took over, not because
		// the 8s watchdog gave up.
		const timing = await page.evaluate(() => window.__icpcE2e)
		check('cover was retired early, not by the 8s watchdog fallback',
			timing.coverRetiredAt !== null && timing.coverRetiredAt < 8000,
			timing.coverRetiredAt === null ? 'never retired' : `${timing.coverRetiredAt} ms after navigation`)

		check('no uncaught exceptions in the real app', pageErrors.length === 0,
			pageErrors.length === 0 ? 'none' : pageErrors.join(' | ').slice(0, 400))
		const relevant = consoleErrors.filter((text) => !/favicon|net::ERR_/i.test(text))
		check('no application console errors', relevant.length === 0,
			relevant.length === 0 ? 'none' : relevant.join(' | ').slice(0, 400))

		// ------------------------------------------------------ skip and "off"
		console.log('\n[3/3] skip key, "off", and the second clip, in the real app')
		await page.keyboard.press('Escape')
		await page.waitForFunction('document.getElementById("dsh-icpc-boot-stage") === null', { timeout: 8000 })
		check('Escape dismisses the splash in the real app', true)

		await page.evaluate(() => window.localStorage.setItem('dsh-icpc-boot:mode', 'off'))
		await page.reload({ waitUntil: 'domcontentloaded' })
		await delay(3000)
		const offState = await page.evaluate(() => ({
			cover: document.documentElement.classList.contains('dshicpc-first'),
			global: typeof window.__dshIcpcFirstFrame,
			stage: document.getElementById('dsh-icpc-boot-stage') !== null
		}))
		check('"off" injects no cover class', offState.cover === false)
		check('"off" injects no first-frame script global', offState.global === 'undefined', offState.global)
		check('"off" mounts no stage', offState.stage === false)

		await page.evaluate(() => window.localStorage.setItem('dsh-icpc-boot:mode', 'neon'))
		await page.reload({ waitUntil: 'domcontentloaded' })
		await page.waitForFunction(
			'document.getElementById("dsh-icpc-boot-stage")?.shadowRoot?.querySelector("video")?.readyState >= 1',
			{ timeout: 30000 }
		)
		const neonMeta = await page.evaluate(() => {
			const video = document.getElementById('dsh-icpc-boot-stage').shadowRoot.querySelector('video')
			return { src: video.getAttribute('src'), duration: video.duration, width: video.videoWidth }
		})
		const neonFrame = await sampleAt(5.4)
		console.log(`      neon src=${neonMeta.src} duration=${neonMeta.duration} ${neonMeta.width}px`)
		show('t=5.4', neonFrame)
		check('neon preference selected the second asset', neonMeta.src === NEON_PATH, String(neonMeta.src))
		check('neon clip duration is ~6s', Math.abs(neonMeta.duration - 6) < 0.3, String(neonMeta.duration))
		check('neon clip decoded from the real route', neonMeta.width === 1920, `${neonMeta.width}px`)
		check('neon frame is brighter than the intro logo frame', neonFrame.lit > 0.1 && neonFrame.luma > atLogo.luma,
			`lit=${neonFrame.lit.toFixed(4)} luma=${neonFrame.luma.toFixed(4)}`)

		await page.evaluate(() => window.localStorage.removeItem('dsh-icpc-boot:mode'))
	} finally {
		await browser.close()
	}
}

killApp(child)
if (child !== undefined && process.env.ICPC_E2E_KEEP !== '1') {
	await delay(1200)
	rmSync(E2E_HOME, { recursive: true, force: true })
} else if (child !== undefined) {
	console.log(`\nkept the throwaway home at ${E2E_HOME} (ICPC_E2E_KEEP=1)`)
}

const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} end-to-end checks passed`)
if (failed.length > 0) {
	for (const entry of failed) {
		console.log(`  FAILED: ${entry.label}${entry.detail === undefined ? '' : ` (${entry.detail})`}`)
	}
	if (process.exitCode !== 1) process.exitCode = 1
}

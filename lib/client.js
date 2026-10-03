/**
 * dsh-icpc-boot — browser half.
 *
 * The splash itself, plus one settings row that chooses between the two clips
 * and "off".
 *
 * The overlay is mounted while this module is being *evaluated*, not from
 * `apply`: the kernel evaluates plugin modules and then calls `apply` on the
 * next tick, and the whole point of the cover the host half injects is to hand
 * over to something as early as possible. `apply` therefore only registers the
 * settings row and the teardown.
 *
 * Nothing here is on the critical path of the application: the video plays over
 * a fixed layer, clicks and Escape skip it, and every failure path (missing
 * route, refused autoplay, decode error, a clip longer than its own metadata
 * promises) ends in the same `stop()` that removes the layer.
 */
window.__ModuleLoader__.load({
	id: 'dsh-icpc-boot',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var React = require('react');
		var h = React.createElement;

		/** Shared with the host half. */
		var MODE_KEY = 'dsh-icpc-boot:mode';
		var ROUTE_BASE = '/dsh-icpc-boot';
		var HOST_ID = 'dsh-icpc-boot-stage';
		var MODES = ['intro', 'neon', 'off'];
		var DEFAULT_MODE = 'intro';

		var CLIPS = {
			intro: ROUTE_BASE + '/assets/icpc-intro.mp4',
			neon: ROUTE_BASE + '/assets/icpc-neon.mp4'
		};

		/** Matches the host half's cover so cover -> video has no seam. */
		var BACKGROUNDS = {
			intro: '#000',
			neon:
				'radial-gradient(ellipse 72.9% 74.1% at 50% 46.3%,' +
				'#0a122c 0%,#050916 25%,#020308 50%,#000 75%)'
		};

		/** Fade-out length; the host half's cover is retired far earlier. */
		var FADE_MS = 460;
		/** Cap before the clip's own metadata arrives. */
		var WATCHDOG_IDLE_MS = 9000;
		/** Extra slack past the advertised duration before we give up on `ended`. */
		var WATCHDOG_SLACK_MS = 2500;

		var CSS = [
			':host{all:initial}',
			'.stage{position:fixed;inset:0;z-index:2147483200;display:flex;',
			'align-items:center;justify-content:center;background:#000;opacity:1;',
			'transition:opacity ' + FADE_MS + 'ms cubic-bezier(0.4,0,0.2,1)}',
			'.stage.is-neon{background:' + BACKGROUNDS.neon + '}',
			'.stage.is-out{opacity:0}',
			'.clip{display:block;width:100%;height:100%;object-fit:cover}',
			'@media (prefers-reduced-motion: reduce){.stage{transition:none}}'
		].join('');

		var ROW_STYLE = {
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: '12px',
			width: '100%',
			minWidth: 0
		};
		var ROW_TEXT_STYLE = { display: 'flex', flexDirection: 'column', minWidth: 0 };
		var ROW_TITLE_STYLE = {
			fontSize: '13px',
			lineHeight: '18px',
			color: 'var(--dsw-alias-label-primary, #e6e6e6)'
		};
		var ROW_DESC_STYLE = {
			fontSize: '12px',
			lineHeight: '16px',
			marginTop: '2px',
			color: 'var(--dsw-alias-label-secondary, #9a9a9a)'
		};
		var ROW_ACTIONS_STYLE = {
			display: 'flex',
			alignItems: 'center',
			gap: '8px',
			flexShrink: 0
		};
		var CONTROL_STYLE = {
			fontSize: '12px',
			lineHeight: '16px',
			padding: '4px 8px',
			borderRadius: '6px',
			color: 'var(--dsw-alias-label-primary, #e6e6e6)',
			background: 'var(--dsw-alias-bg-secondary, #232323)',
			border: '1px solid var(--dsw-alias-border-secondary, #3a3a3a)'
		};
		var BUTTON_STYLE = Object.assign({}, CONTROL_STYLE, { cursor: 'pointer' });

		// ------------------------------------------------------------------
		// Mode
		// ------------------------------------------------------------------

		function readMode() {
			try {
				var stored = window.localStorage.getItem(MODE_KEY);
				if (stored !== null && MODES.indexOf(stored) >= 0) return stored;
			} catch (error) {
				/* private mode, or storage disabled: fall through to the default */
			}
			return DEFAULT_MODE;
		}

		function writeMode(mode) {
			try {
				window.localStorage.setItem(MODE_KEY, mode);
			} catch (error) {
				/* nothing to do; the splash still follows the in-memory choice */
			}
		}

		// ------------------------------------------------------------------
		// Splash
		// ------------------------------------------------------------------

		/** The stop() of the layer currently on screen, or null. */
		var active = null;

		/**
		 * Lowers the cover the host half injected, if it is still up. Safe to
		 * call any number of times and when no cover was ever injected.
		 */
		function retireCover() {
			var handshake = window.__dshIcpcFirstFrame;
			if (handshake !== undefined && handshake !== null && typeof handshake.end === 'function') {
				handshake.end();
			}
		}

		/**
		 * Puts a clip on screen and returns its stop function. A second call
		 * while one is playing is ignored — the first one owns the screen.
		 *
		 * @param mode - 'intro' | 'neon' | 'off'; anything else re-reads the
		 *   stored preference.
		 */
		function mount(mode) {
			var resolved = MODES.indexOf(mode) >= 0 ? mode : readMode();
			if (resolved === 'off') return null;
			if (active !== null) return null;
			if (document.getElementById(HOST_ID) !== null) return null;

			var host = document.createElement('div');
			host.id = HOST_ID;
			host.setAttribute('aria-hidden', 'true');

			var shadow = host.attachShadow({ mode: 'open' });
			shadow.innerHTML =
				'<style>' +
				CSS +
				'</style><div class="stage' +
				(resolved === 'neon' ? ' is-neon' : '') +
				'"><video class="clip" playsinline muted autoplay preload="auto"></video></div>';

			var stage = shadow.querySelector('.stage');
			var video = shadow.querySelector('.clip');
			var done = false;

			function onKey(event) {
				if (event.key === 'Escape' || event.key === 'Esc') stop();
			}

			function stop() {
				if (done) return;
				done = true;
				window.clearTimeout(timer);
				window.removeEventListener('keydown', onKey, true);
				stage.removeEventListener('pointerdown', stop);
				retireCover();
				stage.classList.add('is-out');
				window.setTimeout(function () {
					try {
						video.pause();
					} catch (error) {
						/* already detached */
					}
					video.removeAttribute('src');
					try {
						video.load();
					} catch (error) {
						/* nothing to release */
					}
					if (host.parentNode !== null) host.parentNode.removeChild(host);
					if (active === stop) active = null;
				}, FADE_MS);
			}

			var timer = window.setTimeout(stop, WATCHDOG_IDLE_MS);

			video.addEventListener('ended', stop);
			video.addEventListener('error', stop);
			video.addEventListener('loadedmetadata', function () {
				window.clearTimeout(timer);
				var seconds = video.duration;
				var budget =
					isFinite(seconds) && seconds > 0
						? seconds * 1000 + WATCHDOG_SLACK_MS
						: WATCHDOG_IDLE_MS;
				timer = window.setTimeout(stop, budget);
			});
			stage.addEventListener('pointerdown', stop);
			window.addEventListener('keydown', onKey, true);

			video.src = CLIPS[resolved];
			(document.body !== null ? document.body : document.documentElement).appendChild(host);

			var playback = video.play();
			if (playback !== undefined && playback !== null && typeof playback.catch === 'function') {
				playback.catch(function () {
					// Muted autoplay is allowed everywhere; if it is still
					// refused the splash would be a frozen frame, so step aside.
					stop();
				});
			}

			// The cover has done its job the instant the splash is in the tree.
			retireCover();

			active = stop;
			return stop;
		}

		// ------------------------------------------------------------------
		// Settings row
		// ------------------------------------------------------------------

		function SettingsRow() {
			var state = React.useState(readMode);
			var mode = state[0];
			var setMode = state[1];

			function choose(next) {
				writeMode(next);
				setMode(next);
			}

			return h(
				'div',
				{ style: ROW_STYLE },
				h(
					'div',
					{ style: ROW_TEXT_STYLE },
					h('div', { style: ROW_TITLE_STYLE }, 'ICPC 开屏动画'),
					h(
						'div',
						{ style: ROW_DESC_STYLE },
						'启动时播放 ICPC 标识影片；点击画面或按 Esc 可跳过。'
					)
				),
				h(
					'div',
					{ style: ROW_ACTIONS_STYLE },
					h(
						'select',
						{
							style: CONTROL_STYLE,
							value: mode,
							'aria-label': 'ICPC 开屏动画',
							onChange: function (event) {
								choose(event.target.value);
							}
						},
						h('option', { value: 'intro' }, '标准片头'),
						h('option', { value: 'neon' }, '霓虹片头'),
						h('option', { value: 'off' }, '关闭')
					),
					h(
						'button',
						{
							type: 'button',
							style: mode === 'off' ? Object.assign({}, BUTTON_STYLE, { opacity: 0.5 }) : BUTTON_STYLE,
							disabled: mode === 'off',
							onClick: function () {
								if (mode !== 'off') mount(mode);
							}
						},
						'预览'
					)
				)
			);
		}

		// ------------------------------------------------------------------
		// Plugin
		// ------------------------------------------------------------------

		exports.name = 'icpc-boot';
		exports.inject = ['slots'];

		exports.apply = function apply(ctx) {
			ctx.slots.inject('settings.general.item', function () {
				return ctx.slots.register(
					{ name: 'settings.general.item', id: 'icpc-boot', order: 30 },
					SettingsRow
				);
			});
			ctx.effect(function () {
				return function () {
					if (active !== null) active();
				};
			}, 'icpc-boot: splash');
		};

		// Evaluated before apply runs, which is the point: the cover the host
		// half injected is still up, and the splash replaces it here.
		try {
			mount(readMode());
		} catch (error) {
			retireCover();
			if (typeof console !== 'undefined' && console.warn) {
				console.warn('[dsh-icpc-boot] splash did not start:', error);
			}
		}

		/** Replays a clip on demand; used by the settings row and by tests. */
		window.__dshIcpcPreview = function (mode) {
			return mount(mode);
		};
		window.__dshIcpcBoot = {
			readMode: readMode,
			writeMode: writeMode,
			play: mount,
			stop: function () {
				if (active !== null) active();
			}
		};

		return module.exports;
	}
});

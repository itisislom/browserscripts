// ==UserScript==
// @name         ZeroByte AdBlocker (Multi-Base uBlock Engine)
// @namespace    https://tampermonkey.net/
// @version      7.0
// @match        *://*/*
// @allFrames    true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (targetWindow.__zbMultiShield) return;
    targetWindow.__zbMultiShield = true;

    const SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

    const SOURCES = [
        'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/adservers.txt',
        'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
        'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/light.txt',
        'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
    ];

    const BUILTIN_DOMAINS = [
        'an.yandex.ru', 'bs.yandex.ru', 'mc.yandex.ru', 'yandexadexchange.net',
        'ads.adfox.ru', 'awaps.yandex.net', 'googlesyndication.com', 'doubleclick.net',
        'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
        'adservice.google.com', 'pagead2.googlesyndication.com', '2mdn.net',
        'target.my.com', 'ad.mail.ru', 'r.mail.ru', 'top-fwz1.mail.ru',
        'ssp.rambler.ru', 'dsp.rambler.ru', 'relap.io', 'criteo.com', 'criteo.net',
        'taboola.com', 'outbrain.com', 'adnxs.com', 'rubiconproject.com',
        'pubmatic.com', 'openx.net', 'popads.net', 'popcash.net', 'propellerads.com',
        'adsterra.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'mgid.com',
        'lentainform.com', 'smi2.ru', 'directadvert.ru', 'marketgid.com',
        'adriver.ru', 'adhigh.net', 'buzzoola.com', 'plausible.io',
        'hotjar.com', 'reffpa.com', '3bmsp5yymz.com', 'deloton.com',
        'clickadu.com', 'hilltopads.com', 'richpush.co', 'traffichaus.com',
        'pinco7p7.win', 'pinco8p8.win', 'pincocasino.com', 'pin-up.win',
        '1xbet.com', '1x-bet.com', 'melbet.com', 'mostbet.com', 'vavada.com',
        '1win.pro', 'catcasino.com', 'betwinner.com', 'linebet.com'
    ];

    const blockSet = new Set(BUILTIN_DOMAINS);

    function loadCached() {
        try {
            const cached = typeof GM_getValue === 'function' ? GM_getValue('zb_ad_domains', null) : null;
            if (Array.isArray(cached)) {
                for (let i = 0; i < cached.length; i++) {
                    blockSet.add(cached[i]);
                }
            }
        } catch {}
    }

    loadCached();

    function extractDomain(line) {
        line = line.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) return null;

        if (line.startsWith('0.0.0.0 ') || line.startsWith('127.0.0.1 ')) {
            const parts = line.split(/\s+/);
            if (parts[1] && parts[1] !== 'localhost' && !parts[1].endsWith('.local')) {
                return parts[1].toLowerCase();
            }
        }

        if (line.startsWith('||') && line.includes('^')) {
            const end = line.indexOf('^');
            const d = line.slice(2, end).toLowerCase();
            if (d && !d.includes('/') && !d.includes('*') && !d.includes('$')) return d;
        }

        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
            return line.toLowerCase();
        }

        return null;
    }

    async function syncDatabases() {
        try {
            const lastSync = Number((typeof GM_getValue === 'function' ? GM_getValue('zb_last_sync', 0) : 0) || 0);
            if (Date.now() - lastSync < SYNC_INTERVAL_MS) return;

            const newDomains = new Set();

            for (let i = 0; i < SOURCES.length; i++) {
                try {
                    const resp = await fetch(SOURCES[i], { cache: 'no-cache' });
                    if (!resp.ok) continue;

                    const text = await resp.text();
                    const lines = text.split('\n');

                    for (let j = 0; j < lines.length; j++) {
                        const d = extractDomain(lines[j]);
                        if (d) {
                            newDomains.add(d);
                            blockSet.add(d);
                            if (newDomains.size >= 80000) break;
                        }
                    }
                } catch {}
            }

            if (newDomains.size > 0 && typeof GM_setValue === 'function') {
                GM_setValue('zb_ad_domains', Array.from(newDomains));
                GM_setValue('zb_last_sync', Date.now());
            }
        } catch {}
    }

    if (targetWindow === targetWindow.top) {
        setTimeout(syncDatabases, 5000);
    }

    const GENERIC_AD_REGEX = /(^|\.)(agl\d+|cvt-s\d+|onclick\w+|bngpt\w+|adservice|adsystem|traffic\w+|pop\w+)\.(pro|shop|xyz|top|vip|click|link|fun|icu|buzz|com|win)$/i;
    const CASINO_AFF_REGEX = /(3bmsp5yymz|reffpa|pinco|1x-?bet|pin-?up|melbet|mostbet|vavada|1win|vulkan|volcano|catcasino|joycasino|betwinner|linebet|up-x|dragonmoney|soqqa|pokerdom|spinbetter)/i;
    const AD_PATH_REGEX = /\/(pagead\/|adsbygoogle\.js|tag\/js\/gpt\.js|adserver\/|adframe\.|popunder|clickunder|adv\/|1x1\.gif|pixel\.gif|\/o\/s\/[a-f0-9]{32}\.js|vast|vpaid|preroll|midroll|postroll)/i;
    const AD_QUERY_REGEX = /[?&](tag=d_|project=casino|click_id=|pb=|form_email=|s3=|aff_id=|affiliate=|ref=|subid=)/i;

    function isDomainBlocked(host) {
        if (!host) return false;
        let current = host.toLowerCase();
        if (blockSet.has(current)) return true;

        let dot = current.indexOf('.');
        while (dot !== -1) {
            current = current.slice(dot + 1);
            if (blockSet.has(current)) return true;
            dot = current.indexOf('.');
        }
        return false;
    }

    function isAdUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('about:')) return false;

        let parsed;
        try {
            parsed = new URL(rawUrl, location.href);
        } catch {
            return false;
        }

        const host = parsed.hostname;
        if (isDomainBlocked(host)) return true;
        if (GENERIC_AD_REGEX.test(host)) return true;
        if (CASINO_AFF_REGEX.test(host)) return true;
        if (AD_PATH_REGEX.test(parsed.pathname)) return true;
        if (AD_QUERY_REGEX.test(parsed.search)) return true;
        if (CASINO_AFF_REGEX.test(parsed.search)) return true;

        return false;
    }

    const noop = () => {};
    const noopProxy = new Proxy(noop, {
        get: () => noopProxy,
        apply: () => noopProxy,
        construct: () => noopProxy
    });

    targetWindow.adsbygoogle = Object.assign([], { loaded: true, push: noop });
    targetWindow.googletag = {
        cmd: Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } }),
        pubads: () => noopProxy,
        enableServices: noop,
        display: noop,
        defineSlot: () => noopProxy
    };

    targetWindow.yaContextCb = Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } });
    targetWindow.Ya = targetWindow.Ya || {};
    targetWindow.Ya.Context = { AdvManager: { render: noop, renderWidget: noop } };
    targetWindow.Ya.adfoxCode = { create: noop, createAdaptive: noop, createScroll: noop };

    targetWindow._tmr = Object.assign([], { push: noop });
    targetWindow.ym = noop;
    targetWindow.ga = noop;
    targetWindow.gtag = noop;

    const originalFetch = targetWindow.fetch;
    targetWindow.fetch = async function (...args) {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && (input.url || input.href));
        if (isAdUrl(url)) {
            return new Response('', { status: 204, statusText: 'No Content' });
        }
        return originalFetch.apply(this, args);
    };

    const originalXhrOpen = targetWindow.XMLHttpRequest.prototype.open;
    const originalXhrSend = targetWindow.XMLHttpRequest.prototype.send;

    targetWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__isAdBlocked = isAdUrl(String(url));
        if (this.__isAdBlocked) {
            return originalXhrOpen.call(this, method, 'data:text/plain,', ...rest);
        }
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    targetWindow.XMLHttpRequest.prototype.send = function (...args) {
        if (this.__isAdBlocked) {
            queueMicrotask(() => {
                Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
                Object.defineProperty(this, 'status', { value: 204, configurable: true });
                Object.defineProperty(this, 'statusText', { value: 'No Content', configurable: true });
                Object.defineProperty(this, 'responseText', { value: '', configurable: true });
                Object.defineProperty(this, 'response', { value: '', configurable: true });
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('loadend'));
            });
            return;
        }
        return originalXhrSend.apply(this, args);
    };

    if (targetWindow.navigator.sendBeacon) {
        const originalBeacon = targetWindow.navigator.sendBeacon;
        targetWindow.navigator.sendBeacon = function (url, data) {
            if (isAdUrl(url)) return true;
            return originalBeacon.call(this, url, data);
        };
    }

    const OriginalWebSocket = targetWindow.WebSocket;
    targetWindow.WebSocket = function (url, protocols) {
        if (isAdUrl(url)) {
            return {
                close: noop,
                send: noop,
                addEventListener: noop,
                removeEventListener: noop,
                readyState: 3
            };
        }
        return protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    };
    targetWindow.WebSocket.prototype = OriginalWebSocket.prototype;

    const originalSetAttribute = targetWindow.Element.prototype.setAttribute;
    targetWindow.Element.prototype.setAttribute = function (name, value) {
        if ((name === 'src' || name === 'href') && isAdUrl(String(value))) {
            if (this.tagName === 'IMG') {
                return originalSetAttribute.call(this, 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            }
            return;
        }
        return originalSetAttribute.call(this, name, value);
    };

    [targetWindow.HTMLScriptElement, targetWindow.HTMLIFrameElement, targetWindow.HTMLImageElement, targetWindow.HTMLMediaElement, targetWindow.HTMLSourceElement].forEach(cls => {
        if (!cls || !cls.prototype) return;
        const desc = Object.getOwnPropertyDescriptor(cls.prototype, 'src');
        if (desc && desc.set) {
            Object.defineProperty(cls.prototype, 'src', {
                get: desc.get,
                set: function (val) {
                    if (isAdUrl(String(val))) return;
                    desc.set.call(this, val);
                },
                configurable: true
            });
        }
    });

    const originalAnchorClick = targetWindow.HTMLAnchorElement.prototype.click;
    targetWindow.HTMLAnchorElement.prototype.click = function () {
        if (isAdUrl(this.href)) return;
        return originalAnchorClick.apply(this, arguments);
    };

    const originalWindowOpen = targetWindow.open;
    targetWindow.open = function (url, ...args) {
        if (!url || isAdUrl(String(url))) {
            return null;
        }
        return originalWindowOpen.call(this, url, ...args);
    };

    function preventAdClick(e) {
        const target = e.target;
        const anchor = target && target.closest ? target.closest('a') : null;
        if (anchor && anchor.href && isAdUrl(anchor.href)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            anchor.remove();
            return false;
        }

        const adContainer = target && target.closest ? target.closest('.ad-branding, .zplata, ins[data-cp-host], ins[data-key]') : null;
        if (adContainer) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            adContainer.remove();
            return false;
        }
    }

    ['click', 'auxclick', 'mousedown', 'pointerdown'].forEach(ev => {
        targetWindow.addEventListener(ev, preventAdClick, true);
        targetWindow.document.addEventListener(ev, preventAdClick, true);
    });

    const COSMETIC_RULES = [
        'ins.adsbygoogle',
        '[id^="yandex_rtb_"]',
        '[id^="adfox_"]',
        '[class*="ya-partner"]',
        '[id^="div-gpt-ad"]',
        '[data-ad-client]',
        '[data-ad-slot]',
        '[data-ad-format]',
        'iframe[src*="doubleclick"]',
        'iframe[src*="yandex"]',
        'iframe[src*="agl0"]',
        'iframe[id*="google_ads"]',
        '.ad-banner', '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-unit',
        '.adsbox', '.adv-block', '.sponsored-content',
        '.popunder', '[id^="mgid_"]', '[id^="taboola-"]',
        '.ad-branding', '.branding', '[id*="branding"]', '[class*="branding"]', '.brand-wrapper',
        '.zplata', 'ins[data-cp-host]', 'ins[data-key]', 'ins[data-cp-domain]', 'ins.604c7625',
        '.kinogo-short', '[class*="above-player"]', '[class*="under-player"]',
        'a[href*="reffpa"]', 'a[href*="3bmsp5yymz"]', 'a[href*="pinco"]', 'a[href*="1xbet"]',
        'a[href*="pin-up"]', 'a[href*="casino"]', 'a[href*="kinogo.luxury"]',
        '.ytp-ad-overlay-container', '#player-ads', 'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer', '.ytd-promoted-video-renderer'
    ].join(', ');

    function injectCSS() {
        if (targetWindow.document.getElementById('zb-ublock-css')) return;
        const style = targetWindow.document.createElement('style');
        style.id = 'zb-ublock-css';
        style.textContent = `
            ${COSMETIC_RULES} { display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; opacity: 0 !important; pointer-events: none !important; position: absolute !important; left: -9999px !important; }
            body.branded, div.branded { background-image: none !important; cursor: default !important; }
        `;
        (targetWindow.document.head || targetWindow.document.documentElement).appendChild(style);
    }

    if (targetWindow.document.documentElement) {
        injectCSS();
    } else {
        targetWindow.addEventListener('DOMContentLoaded', injectCSS, { once: true });
    }

    function fastForwardVideoAd() {
        const player = targetWindow.document.querySelector('.html5-video-player, #movie_player');
        if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
            const video = player.querySelector('video');
            if (video && isFinite(video.duration) && video.duration > 0) {
                video.muted = true;
                video.playbackRate = 16;
                video.currentTime = video.duration;
            }
            const skipBtn = targetWindow.document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button');
            if (skipBtn) skipBtn.click();
        }
    }

    function cleanElement(el) {
        if (!el || el.nodeType !== 1) return;

        if (el.tagName === 'BODY' && el.classList.contains('branded')) {
            el.classList.remove('branded');
            el.style.backgroundImage = 'none';
        }

        const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('href'));
        if (src && isAdUrl(src)) {
            el.remove();
            return;
        }

        if (el.matches && el.matches(COSMETIC_RULES)) {
            el.remove();
            return;
        }

        if ((el.tagName === 'IMG' || el.tagName === 'IFRAME') && (el.getAttribute('width') === '1' && el.getAttribute('height') === '1')) {
            el.remove();
        }
    }

    let pendingNodes = [];
    let rafScheduled = false;

    function processBatch() {
        rafScheduled = false;

        if (targetWindow.document.body && targetWindow.document.body.classList.contains('branded')) {
            targetWindow.document.body.classList.remove('branded');
            targetWindow.document.body.style.backgroundImage = 'none';
        }

        const nodes = pendingNodes.splice(0);
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.isConnected) {
                cleanElement(node);
                if (node.querySelectorAll) {
                    const matched = node.querySelectorAll(COSMETIC_RULES);
                    for (let j = 0; j < matched.length; j++) {
                        matched[j].remove();
                    }
                }
            }
        }
        fastForwardVideoAd();
    }

    const observer = new MutationObserver(mutations => {
        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                if (added[j].nodeType === 1) {
                    pendingNodes.push(added[j]);
                }
            }
        }
        if (!rafScheduled && pendingNodes.length) {
            rafScheduled = true;
            requestAnimationFrame(processBatch);
        }
    });

    observer.observe(targetWindow.document, {
        childList: true,
        subtree: true
    });

    setInterval(fastForwardVideoAd, 300);
})();

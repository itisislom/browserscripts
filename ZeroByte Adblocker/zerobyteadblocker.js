// ==UserScript==
// @name         ZeroByte AdBlocker
// @namespace    https://tampermonkey.net/
// @version      3.0
// @match        *://*/*
// @allFrames    true
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    if (window.__zbShield) return;
    window.__zbShield = true;

    const AD_DOMAINS = [
        'an.yandex.ru', 'bs.yandex.ru', 'mc.yandex.ru', 'yandexadexchange.net',
        'ads.adfox.ru', 'awaps.yandex.net', 'googlesyndication.com', 'doubleclick.net',
        'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
        'adservice.google', 'pagead2.googlesyndication.com', '2mdn.net',
        'target.my.com', 'ad.mail.ru', 'r.mail.ru', 'top-fwz1.mail.ru',
        'ssp.rambler.ru', 'dsp.rambler.ru', 'relap.io', 'criteo.com', 'criteo.net',
        'taboola.com', 'outbrain.com', 'adnxs.com', 'rubiconproject.com',
        'pubmatic.com', 'openx.net', 'popads.net', 'popcash.net', 'propellerads.com',
        'adsterra.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'mgid.com',
        'lentainform.com', 'smi2.ru', 'directadvert.ru', 'marketgid.com',
        'adriver.ru', 'adhigh.net', 'buzzoola.com', 'plausible.io',
        'hotjar.com', 'adsystem', 'advertising.com'
    ];

    const AD_HOST_REGEX = new RegExp('(^|\\.)(' + AD_DOMAINS.map(d => d.replace(/\./g, '\\.')).join('|') + ')$', 'i');

    const AD_PATH_REGEX = /\/(pagead\/|adsbygoogle\.js|tag\/js\/gpt\.js|adserver\/|adframe\.|popunder|clickunder|adv\/|1x1\.gif|pixel\.gif)/i;

    function isAdUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('about:')) return false;

        let parsed;
        try {
            parsed = new URL(rawUrl, location.href);
        } catch {
            return false;
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
            return false;
        }

        if (AD_HOST_REGEX.test(parsed.hostname)) return true;
        if (AD_PATH_REGEX.test(parsed.pathname)) return true;

        return false;
    }

    const noop = () => {};
    const noopPromise = () => Promise.resolve();
    const noopProxy = new Proxy(noop, {
        get: () => noopProxy,
        apply: () => noopProxy,
        construct: () => noopProxy
    });

    window.adsbygoogle = Object.assign([], { loaded: true, push: noop });
    window.googletag = {
        cmd: Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } }),
        pubads: () => noopProxy,
        enableServices: noop,
        display: noop,
        defineSlot: () => noopProxy
    };

    window.yaContextCb = Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } });
    window.Ya = window.Ya || {};
    window.Ya.Context = { AdvManager: { render: noop, renderWidget: noop } };
    window.Ya.adfoxCode = { create: noop, createAdaptive: noop, createScroll: noop };

    window._tmr = Object.assign([], { push: noop });
    window.ym = noop;
    window.ga = noop;
    window.gtag = noop;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && (input.url || input.href));
        if (isAdUrl(url)) {
            return new Response('', { status: 204, statusText: 'No Content' });
        }
        return originalFetch.apply(this, args);
    };

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__isAdBlocked = isAdUrl(String(url));
        if (this.__isAdBlocked) {
            return originalXhrOpen.call(this, method, 'data:text/plain,', ...rest);
        }
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
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

    if (navigator.sendBeacon) {
        const originalBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function (url, data) {
            if (isAdUrl(url)) return true;
            return originalBeacon.call(this, url, data);
        };
    }

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function (url, protocols) {
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
    window.WebSocket.prototype = OriginalWebSocket.prototype;

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if ((name === 'src' || name === 'href') && isAdUrl(String(value))) {
            if (this.tagName === 'IMG') {
                return originalSetAttribute.call(this, 'src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
            }
            return;
        }
        return originalSetAttribute.call(this, name, value);
    };

    [HTMLScriptElement, HTMLIFrameElement, HTMLImageElement, HTMLMediaElement, HTMLSourceElement].forEach(cls => {
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

    const originalWindowOpen = window.open;
    window.open = function (url, ...args) {
        if (url && isAdUrl(String(url))) {
            return null;
        }
        return originalWindowOpen.call(this, url, ...args);
    };

    const AD_SELECTORS = [
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
        'iframe[id*="google_ads"]',
        '.ad-banner', '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-unit',
        '.adsbox', '.adv-block', '.sponsored-content',
        '.popunder', '[id^="mgid_"]', '[id^="taboola-"]',
        '.ytp-ad-overlay-container', '#player-ads', 'ytd-ad-slot-renderer',
        'ytd-in-feed-ad-layout-renderer', '.ytd-promoted-video-renderer'
    ].join(', ');

    function injectCSS() {
        if (document.getElementById('zb-shield-css')) return;
        const style = document.createElement('style');
        style.id = 'zb-shield-css';
        style.textContent = `${AD_SELECTORS} { display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; opacity: 0 !important; pointer-events: none !important; position: absolute !important; left: -9999px !important; }`;
        (document.head || document.documentElement).appendChild(style);
    }

    if (document.documentElement) {
        injectCSS();
    } else {
        window.addEventListener('DOMContentLoaded', injectCSS, { once: true });
    }

    function fastForwardVideoAd() {
        const player = document.querySelector('.html5-video-player, #movie_player');
        if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
            const video = player.querySelector('video');
            if (video && isFinite(video.duration) && video.duration > 0) {
                video.muted = true;
                video.playbackRate = 16;
                video.currentTime = video.duration;
            }
            const skipBtn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button');
            if (skipBtn) skipBtn.click();
        }
    }

    function cleanElement(el) {
        if (!el || el.nodeType !== 1) return;

        const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('href'));
        if (src && isAdUrl(src)) {
            el.remove();
            return;
        }

        if (el.matches && el.matches(AD_SELECTORS)) {
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
        const nodes = pendingNodes.splice(0);
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.isConnected) {
                cleanElement(node);
                if (node.querySelectorAll) {
                    const matched = node.querySelectorAll(AD_SELECTORS);
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

    observer.observe(document, {
        childList: true,
        subtree: true
    });

    setInterval(fastForwardVideoAd, 300);
})();

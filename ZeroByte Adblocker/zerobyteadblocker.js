// ==UserScript==
// @name         ZeroByte AdBlocker By Islom
// @namespace    https://tampermonkey.net/
// @version      8.0
// @description  Multi-layer ad, casino, popunder, VAST/preroll & tracker blocker with 12 auto-updating databases
// @match        *://*/*
// @allFrames    true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(() => {
    'use strict';

    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (targetWindow.__zbMultiShield) return;
    targetWindow.__zbMultiShield = true;

    const isTop = targetWindow === targetWindow.top;
    const SYNC_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // Обновление каждые 2 дня
    const MAX_CACHED_DOMAINS = 140000;
    let blockedCount = 0;

    // Белый список сайтов (можно переключать через меню Tampermonkey)
    const currentHost = (location.hostname || '').toLowerCase().replace(/^www\./, '');
    function getWhitelist() {
        try {
            const list = typeof GM_getValue === 'function' ? GM_getValue('zb_whitelist', []) : [];
            return new Set(Array.isArray(list) ? list : []);
        } catch {
            return new Set();
        }
    }

    const whitelist = getWhitelist();
    if (currentHost && whitelist.has(currentHost)) return;

    // 12 актуальных баз (AdGuard, RU AdList, OISD, HaGeZi, Firebog, Admiral Anti-Adblock, Peter Lowe, AdAway, StevenBlack)
    const SOURCES = [
        'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
        'https://raw.githubusercontent.com/easylist/ruadlist/master/advblock/adservers.txt',
        'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/light.txt',
        'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/domains/tif.mini.txt',
        'https://small.oisd.nl/domainswild2',
        'https://v.firebog.net/hosts/AdguardDNS.txt',
        'https://v.firebog.net/hosts/Easylist.txt',
        'https://v.firebog.net/hosts/Admiral.txt',
        'https://v.firebog.net/hosts/Prigent-Ads.txt',
        'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml',
        'https://adaway.org/hosts.txt',
        'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'
    ];

    // Расширенная встроенная база (работает мгновенно даже до первой синхронизации)
    const BUILTIN_DOMAINS = [
        // Яндекс / Mail / ВК / Rambler / СНГ сети
        'an.yandex.ru', 'bs.yandex.ru', 'mc.yandex.ru', 'yandexadexchange.net',
        'ads.adfox.ru', 'awaps.yandex.net', 'yabs.yandex.ru', 'adfox.yandex.ru',
        'target.my.com', 'ad.mail.ru', 'r.mail.ru', 'top-fwz1.mail.ru', 'xray.mail.ru',
        'ssp.rambler.ru', 'dsp.rambler.ru', 'relap.io', 'adriver.ru', 'adhigh.net',
        'buzzoola.com', 'smi2.ru', 'lentainform.com', 'directadvert.ru', 'marketgid.com',
        'mgid.com', 'adskeeper.com', 'kadam.net', 'traforet.com', 'adbetnet.com',
        'octoclick.com', 'clickadilla.com', 'galaksion.com', 'evadav.com', 'adprofex.com',
        'alfasense.net', 'videoroll.net', 'booroll.com', 'bazon.site', 'franecki.net',
        'adsby.bidtheatre.com', 'hybrid.ai', 'getintent.ru', 'soloway.ru', 'betweenexchange.com',

        // Google / Глобальные рекламные и трекинговые сети
        'googlesyndication.com', 'doubleclick.net', 'google-analytics.com',
        'googletagmanager.com', 'googletagservices.com', 'adservice.google.com',
        'pagead2.googlesyndication.com', '2mdn.net', 'imasdk.googleapis.com',
        'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'adnxs.com',
        'rubiconproject.com', 'pubmatic.com', 'openx.net', 'smartadserver.com',
        'indexexchange.com', 'casalemedia.com', 'moatads.com', 'scorecardresearch.com',
        'quantserve.com', 'adsafeprotected.com', 'doubleverify.com', 'teads.tv',
        'amazon-adsystem.com', 'ads-twitter.com', 'connect.facebook.net',

        // Popunder / Clickunder / Push / Adult Ad Networks
        'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com', 'exoclick.com',
        'juicyads.com', 'trafficjunky.net', 'plausible.io', 'hotjar.com', 'deloton.com',
        'clickadu.com', 'hilltopads.com', 'richpush.co', 'traffichaus.com', 'adcash.com',
        'bidvertiser.com', 'ero-advertising.com', 'trafficstars.com', 'admaven.com',
        'acscdn.com', 'onmarshtompor.com', 'irtyc.com', 'pushame.com', ' rollerads.com',

        // Казино / Беттинг / Партнерские редиректы
        'reffpa.com', '3bmsp5yymz.com', 'pinco7p7.win', 'pinco8p8.win', 'pincocasino.com',
        'pin-up.win', 'pin-up.casino', '1xbet.com', '1x-bet.com', 'melbet.com', 'mostbet.com',
        'vavada.com', '1win.pro', '1win.run', 'catcasino.com', 'betwinner.com', 'linebet.com',
        'dragonmoney.com', 'up-x.site', 'pokerdom.com', 'spinbetter.com', 'joycasino.com',
        'casino-x.com', 'vulkanvegas.com', 'riobet.com', 'roxcasino.com', 'solcasino.com',
        'freshcasino.com', 'izzicasino.com', 'legzocasino.com', 'starda.casino', 'vodka.bet'
    ];

    const blockSet = new Set(BUILTIN_DOMAINS);
    const urlDecisionCache = new Map();

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
        if (!line || line.startsWith('#') || line.startsWith('!') || line.startsWith('[')) return null;

        // Формат hosts: 0.0.0.0 domain.com или 127.0.0.1 domain.com
        if (line.startsWith('0.0.0.0 ') || line.startsWith('127.0.0.1 ') || line.startsWith('0.0.0.0\t') || line.startsWith('127.0.0.1\t')) {
            const parts = line.split(/\s+/);
            const d = parts[1] ? parts[1].toLowerCase().replace(/^\*\./, '') : '';
            if (d && d !== 'localhost' && d !== '0.0.0.0' && !d.endsWith('.local') && d.includes('.')) {
                return d;
            }
            return null;
        }

        // Формат AdBlock / AdGuard: ||domain.com^ или ||domain.com^$third-party
        if (line.startsWith('||') && line.includes('^')) {
            const end = line.indexOf('^');
            const d = line.slice(2, end).toLowerCase().replace(/^\*\./, '');
            if (d && d.includes('.') && !d.includes('/') && !d.includes('*') && !d.includes('$') && !d.includes(':')) {
                return d;
            }
            return null;
        }

        // Формат OISD wildcard / plain domain: *.domain.com или domain.com
        if (line.startsWith('*.')) {
            line = line.slice(2);
        }

        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(line)) {
            return line.toLowerCase();
        }

        return null;
    }

    // Обход CSP страницы через GM_xmlhttpRequest (с фоллбэком на fetch)
    function fetchListText(url) {
        return new Promise(resolve => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 15000,
                    onload: res => resolve(res.status >= 200 && res.status < 300 ? res.responseText : ''),
                    onerror: () => resolve(''),
                    ontimeout: () => resolve('')
                });
            } else {
                fetch(url, { cache: 'no-store' })
                    .then(r => (r.ok ? r.text() : ''))
                    .catch(() => '')
                    .then(resolve);
            }
        });
    }

    // Удаление избыточных поддоменов (если есть example.com, то sub.example.com не занимает место)
    function compressDomains(domainSet) {
        const result = [];
        for (const d of domainSet) {
            let redundant = false;
            let dot = d.indexOf('.');
            while (dot !== -1) {
                const parent = d.slice(dot + 1);
                if (domainSet.has(parent)) {
                    redundant = true;
                    break;
                }
                dot = d.indexOf('.', dot + 1);
            }
            if (!redundant) {
                result.push(d);
                if (result.length >= MAX_CACHED_DOMAINS) break;
            }
        }
        return result;
    }

    async function syncDatabases(force = false) {
        try {
            const lastSync = Number((typeof GM_getValue === 'function' ? GM_getValue('zb_last_sync', 0) : 0) || 0);
            if (!force && Date.now() - lastSync < SYNC_INTERVAL_MS && blockSet.size > 1000) return;

            const rawCollected = new Set(BUILTIN_DOMAINS);

            const responses = await Promise.all(SOURCES.map(src => fetchListText(src)));
            for (let i = 0; i < responses.length; i++) {
                const text = responses[i];
                if (!text) continue;
                const lines = text.split(/\r?\n/);
                for (let j = 0; j < lines.length; j++) {
                    const d = extractDomain(lines[j]);
                    if (d) rawCollected.add(d);
                }
            }

            const compressed = compressDomains(rawCollected);
            if (compressed.length > BUILTIN_DOMAINS.length) {
                blockSet.clear();
                for (let i = 0; i < compressed.length; i++) {
                    blockSet.add(compressed[i]);
                }
                urlDecisionCache.clear();
                if (typeof GM_setValue === 'function') {
                    GM_setValue('zb_ad_domains', compressed);
                    GM_setValue('zb_last_sync', Date.now());
                }
            }
        } catch {}
    }

    if (isTop) {
        setTimeout(() => syncDatabases(false), 3500);

        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('📊 Статистика ZeroByte', () => {
                alert(
                    `ZeroByte AdBlocker v8.0\n\n` +
                    `• Заблокировано на странице: ${blockedCount}\n` +
                    `• Корневых доменов в базе: ${blockSet.size.toLocaleString()}\n` +
                    `• Текущий сайт: ${currentHost || 'N/A'}`
                );
            });
            GM_registerMenuCommand('🔄 Обновить базы рекламы сейчас', async () => {
                await syncDatabases(true);
                alert(`Базы успешно обновлены! Активных корневых доменов: ${blockSet.size.toLocaleString()}`);
            });
            GM_registerMenuCommand(`🏳️ Переключить белый список для ${currentHost}`, () => {
                if (!currentHost) return;
                const wl = getWhitelist();
                if (wl.has(currentHost)) {
                    wl.delete(currentHost);
                } else {
                    wl.add(currentHost);
                }
                if (typeof GM_setValue === 'function') {
                    GM_setValue('zb_whitelist', Array.from(wl));
                }
                location.reload();
            });
        }
    }

    const GENERIC_AD_REGEX = /(^|\.)(agl\d+|cvt-s\d+|onclick\w+|bngpt\w+|adservice|adsystem|adserver\w*|traffic\w+|popunder\w*|clickunder\w*)\.(pro|shop|xyz|top|vip|click|link|fun|icu|buzz|com|win|net|org|site|online)$/i;
    const CASINO_AFF_REGEX = /(3bmsp5yymz|reffpa|pinco|1x-?bet|pin-?up|melbet|mostbet|vavada|1win|vulkan|volcano|catcasino|joycasino|betwinner|linebet|up-x|dragonmoney|soqqa|pokerdom|spinbetter|riobet|starda|legzo|vodkabet)/i;
    const AD_PATH_REGEX = /\/(pagead\/|adsbygoogle\.js|tag\/js\/gpt\.js|adserver\/|adframe\.|popunder|clickunder|adv\/|1x1\.gif|pixel\.gif|\/o\/s\/[a-f0-9]{32}\.js|aclib\.js| prebid[\w.-]*\.js)/i;
    const VAST_REGEX = /(\b(vast|vpaid|vmap|preroll|midroll|postroll|adbreak)\b|ad_tag=|adtag=|vast\.xml|\/vast\/)/i;
    const AD_QUERY_REGEX = /[?&](tag=d_|project=casino|click_id=|pb=|form_email=|s3=|aff_id=|affiliate=|sub_id=|partner_id=|banner_id=|ad_type=)/i;
    const INLINE_AD_SCRIPT_REGEX = /(aclib\.runPop|BetterJsPop|popunder|clickunder|window\.open\s*\(\s*['"]https?:\/\/[^'"]*(reffpa|pinco|1win|1xbet|vavada|melbet|mostbet)|atOptions\s*=\s*\{[^}]*['"]key['"]\s*:)/i;

    function isDomainBlocked(host) {
        if (!host) return false;
        let current = host.toLowerCase();
        if (current === currentHost) return false; // Не блокируем сам домен сайта, на котором находимся
        if (blockSet.has(current)) return true;

        let dot = current.indexOf('.');
        while (dot !== -1) {
            current = current.slice(dot + 1);
            if (current === currentHost) return false;
            if (blockSet.has(current)) return true;
            dot = current.indexOf('.');
        }
        return false;
    }

    function isVastRequest(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        return VAST_REGEX.test(rawUrl);
    }

    function isAdUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('javascript:')) return false;
        if (rawUrl.startsWith('about:')) return false;

        const cached = urlDecisionCache.get(rawUrl);
        if (cached !== undefined) {
            if (cached) blockedCount++;
            return cached;
        }

        let parsed;
        try {
            parsed = new URL(rawUrl, location.href);
        } catch {
            return false;
        }

        const host = parsed.hostname.toLowerCase();
        const isSameDomain = host === currentHost || host.endsWith('.' + currentHost);

        let result = false;
        if (!isSameDomain && isDomainBlocked(host)) result = true;
        else if (GENERIC_AD_REGEX.test(host)) result = true;
        else if (CASINO_AFF_REGEX.test(host)) result = true;
        else if (AD_PATH_REGEX.test(parsed.pathname)) result = true;
        else if (VAST_REGEX.test(parsed.pathname) || VAST_REGEX.test(parsed.search)) result = true;
        else if (!isSameDomain && AD_QUERY_REGEX.test(parsed.search)) result = true;
        else if (CASINO_AFF_REGEX.test(parsed.search) || CASINO_AFF_REGEX.test(parsed.pathname)) result = true;

        if (urlDecisionCache.size > 2500) urlDecisionCache.clear();
        urlDecisionCache.set(rawUrl, result);

        if (result) blockedCount++;
        return result;
    }

    // Валидная пустая XML-заглушка VAST 3.0 — видеоплееры мгновенно начинают воспроизведение фильма без ошибок
    const EMPTY_VAST_XML = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

    const noop = () => {};
    const noopTrue = () => true;
    const noopFalse = () => false;
    const noopProxy = new Proxy(noop, {
        get: (target, prop) => {
            if (prop === Symbol.toPrimitive) return () => '';
            if (prop === 'then') return undefined;
            return noopProxy;
        },
        apply: () => noopProxy,
        construct: () => noopProxy
    });

    // Заглушки рекламных SDK + Защита от Anti-AdBlock
    function installSpoofs() {
        try {
            targetWindow.adsbygoogle = Object.assign([], { loaded: true, push: noop });
            targetWindow.googletag = {
                cmd: Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } }),
                pubads: () => noopProxy,
                companionAds: () => noopProxy,
                enableServices: noop,
                display: noop,
                defineSlot: () => noopProxy,
                defineOutOfPageSlot: () => noopProxy,
                destroySlots: noop,
                apiReady: true,
                pubadsReady: true
            };

            targetWindow.yaContextCb = Object.assign([], { push: fn => { try { if (typeof fn === 'function') fn(); } catch {} } });
            targetWindow.yandex_context_callbacks = targetWindow.yaContextCb;
            targetWindow.Ya = targetWindow.Ya || {};
            targetWindow.Ya.Context = { AdvManager: { render: noop, renderWidget: noop, getPlatform: () => 'desktop' } };
            targetWindow.Ya.adfoxCode = { create: noop, createAdaptive: noop, createScroll: noop, reload: noop };

            targetWindow._tmr = Object.assign([], { push: noop });
            targetWindow.ym = noop;
            targetWindow.ga = noop;
            targetWindow.gtag = noop;
            targetWindow.aclib = { runPop: noop, runBanner: noop, runAutoTag: noop, runInterstitial: noop, runInPagePush: noop };

            // Обход Anti-AdBlock детекторов (BlockAdBlock / FuckAdBlock / Admiral)
            targetWindow.canRunAds = true;
            targetWindow.canShowAds = true;
            targetWindow.isAdBlockActive = false;
            targetWindow.adblock = false;
            targetWindow.adBlockEnabled = false;
            targetWindow.google_ad_status = 1;

            const FakeAdBlockDetector = function () {};
            FakeAdBlockDetector.prototype = {
                on: function (detected, fn) { return this; },
                onDetected: function () { return this; },
                onNotDetected: function (fn) { try { if (typeof fn === 'function') fn(); } catch {} return this; },
                check: noopTrue,
                emitEvent: noop,
                clearEvent: noop,
                setOption: function () { return this; }
            };
            const fakeInstance = new FakeAdBlockDetector();
            targetWindow.FuckAdBlock = FakeAdBlockDetector;
            targetWindow.BlockAdBlock = FakeAdBlockDetector;
            targetWindow.fuckAdBlock = fakeInstance;
            targetWindow.blockAdBlock = fakeInstance;
        } catch {}
    }

    installSpoofs();

    // Перехват Fetch (с умной подменой VAST XML)
    const originalFetch = targetWindow.fetch;
    if (typeof originalFetch === 'function') {
        targetWindow.fetch = async function (...args) {
            const input = args[0];
            const url = typeof input === 'string' ? input : (input && (input.url || input.href));
            if (url && isAdUrl(url)) {
                if (isVastRequest(url)) {
                    return new Response(EMPTY_VAST_XML, {
                        status: 200,
                        headers: { 'Content-Type': 'application/xml; charset=utf-8' }
                    });
                }
                return new Response('', { status: 204, statusText: 'No Content' });
            }
            return originalFetch.apply(this, args);
        };
    }

    // Перехват XMLHttpRequest (с умной подменой VAST XML)
    const originalXhrOpen = targetWindow.XMLHttpRequest.prototype.open;
    const originalXhrSend = targetWindow.XMLHttpRequest.prototype.send;

    targetWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const strUrl = String(url || '');
        this.__isAdBlocked = isAdUrl(strUrl);
        this.__isVastBlocked = this.__isAdBlocked && isVastRequest(strUrl);
        if (this.__isAdBlocked) {
            return originalXhrOpen.call(this, method, 'data:text/plain,', ...rest);
        }
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    targetWindow.XMLHttpRequest.prototype.send = function (...args) {
        if (this.__isAdBlocked) {
            const isVast = this.__isVastBlocked;
            queueMicrotask(() => {
                try {
                    const body = isVast ? EMPTY_VAST_XML : '';
                    Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
                    Object.defineProperty(this, 'status', { value: isVast ? 200 : 204, configurable: true });
                    Object.defineProperty(this, 'statusText', { value: isVast ? 'OK' : 'No Content', configurable: true });
                    Object.defineProperty(this, 'responseText', { value: body, configurable: true });
                    Object.defineProperty(this, 'response', { value: body, configurable: true });
                    if (isVast && typeof DOMParser !== 'undefined') {
                        const xmlDoc = new DOMParser().parseFromString(EMPTY_VAST_XML, 'text/xml');
                        Object.defineProperty(this, 'responseXML', { value: xmlDoc, configurable: true });
                    }
                    this.dispatchEvent(new Event('readystatechange'));
                    this.dispatchEvent(new Event('load'));
                    this.dispatchEvent(new Event('loadend'));
                } catch {}
            });
            return;
        }
        return originalXhrSend.apply(this, args);
    };

    if (targetWindow.navigator && targetWindow.navigator.sendBeacon) {
        const originalBeacon = targetWindow.navigator.sendBeacon;
        targetWindow.navigator.sendBeacon = function (url, data) {
            if (isAdUrl(url)) return true;
            return originalBeacon.call(this, url, data);
        };
    }

    const OriginalWebSocket = targetWindow.WebSocket;
    if (typeof OriginalWebSocket === 'function') {
        targetWindow.WebSocket = function (url, protocols) {
            if (isAdUrl(String(url))) {
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
    }

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

    [
        targetWindow.HTMLScriptElement,
        targetWindow.HTMLIFrameElement,
        targetWindow.HTMLImageElement,
        targetWindow.HTMLMediaElement,
        targetWindow.HTMLSourceElement,
        targetWindow.HTMLEmbedElement
    ].forEach(cls => {
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

    // Защита от Popunder через window.open (включая трюк с about:blank)
    const originalWindowOpen = targetWindow.open;
    targetWindow.open = function (url, ...args) {
        const strUrl = url ? String(url).trim() : '';
        if (!strUrl || strUrl === 'about:blank' || isAdUrl(strUrl)) {
            blockedCount++;
            return null;
        }
        return originalWindowOpen.call(this, url, ...args);
    };

    function preventAdClick(e) {
        const target = e.target;
        if (!target || !target.closest) return;

        const anchor = target.closest('a');
        if (anchor && anchor.href && isAdUrl(anchor.href)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            anchor.remove();
            return false;
        }

        const adContainer = target.closest('.ad-branding, .zplata, ins[data-cp-host], ins[data-key], [id^="yandex_rtb_"], [id^="adfox_"]');
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

    // ВАЖНО: .adsbox намеренно исключён из скрытия, так как Anti-AdBlock скрипты проверяют его высоту
    const SAFE_COSMETIC_RULES = [
        'ins.adsbygoogle',
        '[id^="yandex_rtb_"]',
        '[id^="adfox_"]',
        '[class*="ya-partner"]',
        '[id^="div-gpt-ad"]',
        '[data-ad-client]',
        '[data-ad-slot]',
        '[data-ad-format]',
        'iframe[src*="doubleclick"]',
        'iframe[src*="yandexadexchange"]',
        'iframe[src*="ads.adfox"]',
        'iframe[src*="agl0"]',
        'iframe[id*="google_ads"]',
        '.ad-banner', '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-unit',
        '.adv-block', '.sponsored-content', '.rek-block', '.b-banner',
        '.popunder', '[id^="mgid_"]', '[id^="taboola-"]', '[id^="outbrain_"]',
        '.ad-branding', '.branding-bg', '.brand-wrapper',
        '.zplata', 'ins[data-cp-host]', 'ins[data-key]', 'ins[data-cp-domain]', 'ins.604c7625',
        '.kinogo-short', '[class*="above-player-ad"]', '[class*="under-player-ad"]',
        'a[href*="reffpa"]', 'a[href*="3bmsp5yymz"]', 'a[href*="pinco"]', 'a[href*="1xbet"]',
        'a[href*="pin-up"]', 'a[href*="1win."]', 'a[href*="vavada"]', 'a[href*="melbet"]',
        'a[href*="mostbet"]', 'a[href*="dragonmoney"]', 'a[href*="kinogo.luxury"]',
        '.ytp-ad-overlay-container', '.ytp-ad-player-overlay-layout', '#player-ads',
        'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', '.ytd-promoted-video-renderer',
        'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', 'ytd-banner-promo-renderer'
    ].join(', ');

    function injectCSS() {
        if (targetWindow.document.getElementById('zb-ublock-css')) return;
        const style = targetWindow.document.createElement('style');
        style.id = 'zb-ublock-css';
        style.textContent = `
            ${SAFE_COSMETIC_RULES},
            ytd-rich-item-renderer:has(ytd-ad-slot-renderer) {
                display: none !important;
                visibility: hidden !important;
                width: 0 !important;
                height: 0 !important;
                opacity: 0 !important;
                pointer-events: none !important;
                position: absolute !important;
                left: -9999px !important;
            }
            body.branded, div.branded {
                background-image: none !important;
                padding-top: 0 !important;
                cursor: default !important;
            }
        `;
        (targetWindow.document.head || targetWindow.document.documentElement).appendChild(style);
    }

    if (targetWindow.document.documentElement) {
        injectCSS();
    } else {
        targetWindow.addEventListener('DOMContentLoaded', injectCSS, { once: true });
    }

    // Умный пропуск видеорекламы (YouTube + HTML5 VAST плееры) с восстановлением звука и скорости
    let savedUserRate = 1;
    let savedUserMuted = false;
    let wasInAd = false;

    function fastForwardVideoAd() {
        // 1. Автоклик по кнопкам пропуска в разных плеерах (YouTube, PlayerJS, JWPlayer, VideoJS)
        const skipBtn = targetWindow.document.querySelector(
            '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button, ' +
            '.vast-skip-button, .jw-skip, .vjs-skip-button, [class*="skip-ad"]'
        );
        if (skipBtn) {
            try { skipBtn.click(); } catch {}
        }

        // 2. Обработка YouTube-плеера с сохранением и возвратом пользовательских настроек
        const player = targetWindow.document.querySelector('.html5-video-player, #movie_player');
        if (!player) return;

        const video = player.querySelector('video');
        if (!video) return;

        const isAdShowing = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
        if (isAdShowing) {
            if (!wasInAd) {
                wasInAd = true;
                savedUserRate = video.playbackRate > 0 && video.playbackRate <= 2 ? video.playbackRate : 1;
                savedUserMuted = video.muted;
            }
            video.muted = true;
            video.playbackRate = 16;
            if (isFinite(video.duration) && video.duration > 0.5) {
                video.currentTime = Math.max(0, video.duration - 0.1);
            }
        } else if (wasInAd) {
            wasInAd = false;
            video.playbackRate = savedUserRate;
            video.muted = savedUserMuted;
        }
    }

    // Удаление прозрачных кликджекинг-оверлеев поверх страницы/плеера
    function isInvisibleClickHijack(el) {
        if (el.tagName !== 'DIV' && el.tagName !== 'A') return false;
        if (el.children.length > 2 || (el.textContent && el.textContent.trim().length > 0)) return false;
        const style = el.style;
        if (!style) return false;
        const z = parseInt(style.zIndex || '0', 10);
        if (z > 99999 && (style.position === 'fixed' || style.position === 'absolute')) {
            const rect = el.getBoundingClientRect();
            if (rect.width >= targetWindow.innerWidth * 0.8 && rect.height >= targetWindow.innerHeight * 0.8) {
                return true;
            }
        }
        return false;
    }

    function cleanElement(el) {
        if (!el || el.nodeType !== 1) return;

        if (el.tagName === 'BODY' && el.classList.contains('branded')) {
            el.classList.remove('branded');
            el.style.backgroundImage = 'none';
        }

        // Блокировка инлайн-скриптов с поп-андерами и редиректами на казино
        if (el.tagName === 'SCRIPT') {
            const src = el.getAttribute('src');
            if (src && isAdUrl(src)) {
                el.remove();
                return;
            }
            if (!src && el.textContent && INLINE_AD_SCRIPT_REGEX.test(el.textContent)) {
                el.textContent = '';
                el.remove();
                blockedCount++;
                return;
            }
        }

        const src = el.getAttribute && (el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data-src'));
        if (src && isAdUrl(src)) {
            el.remove();
            return;
        }

        try {
            if (el.matches && el.matches(SAFE_COSMETIC_RULES)) {
                el.remove();
                blockedCount++;
                return;
            }
        } catch {}

        if ((el.tagName === 'IMG' || el.tagName === 'IFRAME') && el.getAttribute('width') === '1' && el.getAttribute('height') === '1') {
            el.remove();
            return;
        }

        if (isInvisibleClickHijack(el)) {
            el.remove();
            blockedCount++;
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
                    try {
                        const matched = node.querySelectorAll(SAFE_COSMETIC_RULES);
                        for (let j = 0; j < matched.length; j++) {
                            matched[j].remove();
                            blockedCount++;
                        }
                    } catch {}
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

// ==UserScript==
// @name         VideoHunter
// @namespace    https://tampermonkey.net/
// @version      1.5
// @match        *://*/*
// @allFrames    true
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
    if (window.__vhInstalled) return;
    window.__vhInstalled = true;

    const isTop = window === window.top;
    const TOKEN = {};
    let stopped = false;
    let nextId = 1;
    let nextFrame = 1;
    let domTimer = null;

    const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:']);
    const MAX_ITEMS = 1000;
    const MAX_DEPTH = 6;
    const CATS = [
        ['DIRECT', 'Video files', '#10b981'],
        ['STREAM', 'Streams (HLS, DASH)', '#f59e0b'],
        ['CHUNKS', 'Segments', '#ec4899'],
        ['BLOB', 'Blob / MediaSource', '#a855f7'],
        ['EMBED', 'Iframe players', '#3b82f6'],
        ['AUDIO', 'Audio', '#06b6d4']
    ];

    const found = new Map();
    const rawSegments = new Set();
    const drmSystems = new Set();
    const attachedDocs = new WeakSet();
    const frameNums = new WeakMap();

    const REGEX = {
        direct: /\.(mp4|webm|mkv|mov|avi|flv|ogv|3gp|m4v|wmv)$/i,
        stream: /\.(m3u8|mpd|f4m|ism\/manifest)$/i,
        streamInQuery: /\.(m3u8|mpd)(?![\w-])/i,
        segment: /\.(ts|m4s|cmfv|cmfa)$/i,
        audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i,
        staticAsset: /\.(js|mjs|css|map|json|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot)$/i,
        manifestPath: /(^|\/)(manifest|playlist|master)([./]|$)/i,
        rawUrl: /https?:\/\/[^\s"'\\<>]+?\.(mp4|webm|mkv|mov|m3u8|mpd|ts|m4s|mp3|wav)(?=[?#"'\\<>\s,;)]|$)(\?[^\s"'\\<>]+)?/gi,
        escapedUrl: /https?:\\\/\\\/[^\s"'<>]+?\.(mp4|webm|mkv|mov|m3u8|mpd|ts|m4s)(?=[?#"'<>\s,;)]|\\u|$)(\?[^\s"'<>]+)?/gi,
        embed: /(youtube\.com\/embed|player\.vimeo|tiktok\.com\/embed|vk\.com\/video_ext|vkvideo\.ru\/video_ext|rutube\.ru\/play\/embed|dzen\.ru\/embed|ok\.ru\/videoembed|kinescope\.io|boomstream\.com|player\.twitch\.tv|mail\.ru\/video\/embed)/i,
        iframePlayer: /embed|player|video/i,
        adFrame: /recaptcha|hcaptcha|doubleclick|googlesyndication|googletagmanager|adservice|challenges\.cloudflare|facebook\.com\/(plugins|tr)|platform\.twitter|disqus/i
    };
    const SELECTOR = 'video, source, iframe, frame, audio, embed, object, a[href], [data-src], [data-video], [data-mp4], [data-url], [data-stream]';

    function setSafeHTML(element, htmlString) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');
            element.replaceChildren(...doc.body.childNodes);
        } catch {
            element.textContent = '';
        }
    }

    function normalizeUrl(raw, base) {
        if (!raw || typeof raw !== 'string') return null;
        let u = raw.trim()
            .replace(/\\\//g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\u003d/gi, '=')
            .replace(/&amp;/g, '&');
        if (u.startsWith('//')) u = location.protocol + u;
        if (!/^(https?:|blob:|data:)/i.test(u)) {
            try { u = new URL(u, base || location.href).href; } catch { return null; }
        }
        return u;
    }

    function determineType(url, parsed, meta = {}) {
        const path = parsed.pathname;
        if (url.startsWith('blob:')) return 'BLOB';
        if (meta.forceType) return meta.forceType;

        if (parsed.hostname.includes('googlevideo.com') || path.includes('/videoplayback')) {
            const mime = parsed.searchParams.get('mime') || '';
            if (mime.includes('audio')) return 'AUDIO';
            return 'DIRECT';
        }

        if (REGEX.stream.test(path) || REGEX.streamInQuery.test(parsed.search)) return 'STREAM';
        if (!meta.fallbackType && REGEX.staticAsset.test(path)) return null;
        if (REGEX.segment.test(path)) return 'CHUNKS';
        if (REGEX.audio.test(path)) return 'AUDIO';
        if (REGEX.direct.test(path)) return 'DIRECT';
        if (REGEX.embed.test(url)) return 'EMBED';
        if (REGEX.manifestPath.test(path)) return 'STREAM';
        return meta.fallbackType || null;
    }

    function catKey(type) {
        return type.split(' ')[0];
    }

    function newItem(o) {
        return Object.assign({ id: nextId++, count: 1, videoEl: null, resolution: null, duration: null, folder: null, qualities: null }, o);
    }

    function parseM3u8Text(text, baseUrl) {
        if (!text || !text.includes('#EXTM3U')) return null;
        const lines = text.split(/\r?\n/);
        const result = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
                const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
                if (nextLine && !nextLine.startsWith('#')) {
                    const absUrl = normalizeUrl(nextLine, baseUrl);
                    if (absUrl) {
                        result.push({
                            resolution: resMatch ? resMatch[1] : 'stream',
                            url: absUrl
                        });
                    }
                }
            }
        }
        return result.length ? result : null;
    }

    async function inspectManifest(url, item) {
        if (!url || !url.includes('.m3u8') || item.qualities) return;
        try {
            const resp = await fetch(url, { method: 'GET', credentials: 'omit' });
            if (!resp.ok) return;
            const text = await resp.text();
            const q = parseM3u8Text(text, url);
            if (q) {
                item.qualities = q;
                if (isTop && isModalOpen()) renderItems();
            }
        } catch {}
    }

    function addMedia(rawUrl, source, meta = {}) {
        if (stopped) return;
        let normalized = normalizeUrl(rawUrl, meta.base);
        if (!normalized || normalized.length > 3000) return;

        let parsed;
        try { parsed = new URL(normalized); } catch { return; }
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return;

        if (parsed.hostname.includes('googlevideo.com') || parsed.pathname.includes('/videoplayback')) {
            parsed.searchParams.delete('range');
            parsed.searchParams.delete('rn');
            parsed.searchParams.delete('rbuf');
            normalized = parsed.href;
        }

        const url = normalized;

        if (!isTop) {
            try {
                window.top.postMessage({
                    type: 'VH_MEDIA_FOUND',
                    rawUrl: url,
                    source: `[${location.hostname}] ${source}`,
                    meta: {
                        resolution: meta.resolution,
                        duration: meta.duration,
                        forceType: meta.forceType,
                        fallbackType: meta.fallbackType
                    }
                }, '*');
            } catch {}
            return;
        }

        const type = determineType(url, parsed, meta);
        if (!type) return;

        if (type.startsWith('CHUNKS')) {
            if (rawSegments.has(url)) return;
            rawSegments.add(url);
            const folder = parsed.origin + parsed.pathname.replace(/\/[^/]*$/, '/');
            const key = 'seg:' + folder;
            const group = found.get(key);
            if (group) {
                group.count++;
            } else {
                if (found.size >= MAX_ITEMS) return;
                found.set(key, newItem({ type, source, url, folder }));
            }
            if (isModalOpen()) renderItems();
            return;
        }

        let existing = found.get(url);
        if (!existing) {
            if (found.size >= MAX_ITEMS) return;
            existing = newItem({ type, source, url, videoEl: meta.videoEl || null, resolution: meta.resolution || null, duration: meta.duration || null });
            found.set(url, existing);
            if (type.startsWith('STREAM')) inspectManifest(url, existing);
            if (isModalOpen()) renderItems();
            return;
        }
        if (meta.videoEl && !existing.videoEl) existing.videoEl = meta.videoEl;
        if (meta.resolution) existing.resolution = meta.resolution;
        if (meta.duration) existing.duration = meta.duration;
    }

    function extractFromText(text, sourceLabel, meta) {
        if (!text || typeof text !== 'string' || text.length > 500000) return;
        const m1 = text.match(REGEX.rawUrl) || [];
        const m2 = text.match(REGEX.escapedUrl) || [];
        [...m1, ...m2].forEach(match => addMedia(match, sourceLabel, meta));
    }

    function metaFromContentType(ct) {
        if (ct.includes('mpegurl') || ct.includes('dash+xml')) return { forceType: 'STREAM' };
        if (ct.includes('mp2t') || ct.includes('iso.segment')) return { forceType: 'CHUNKS' };
        if (ct.startsWith('video/')) return { fallbackType: 'DIRECT' };
        if (ct.startsWith('audio/')) return { fallbackType: 'AUDIO' };
        return null;
    }

    function parseYouTubePlayerData(jsonText, ctxMeta) {
        try {
            const data = JSON.parse(jsonText);
            const sd = data && (data.streamingData || data.playerResponse?.streamingData);
            if (sd) {
                const formats = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
                formats.forEach(f => {
                    if (f.url) {
                        const isAudio = (f.mimeType || '').includes('audio');
                        const res = f.qualityLabel || (isAudio ? 'Audio' : null);
                        addMedia(f.url, 'YouTube Stream API', Object.assign({}, ctxMeta, {
                            resolution: res,
                            forceType: isAudio ? 'AUDIO' : 'DIRECT'
                        }));
                    }
                });
            }
        } catch {}
    }

    function hookWindow(w, label) {
        const ctxMeta = () => {
            try { return { frame: label, base: w.document.baseURI }; } catch { return { frame: label }; }
        };

        try {
            const origFetch = w.fetch;
            if (typeof origFetch === 'function') {
                w.fetch = async function(...args) {
                    const a = args[0];
                    const reqUrl = typeof a === 'string' ? a : (a && (a.url || a.href));
                    if (reqUrl) addMedia(reqUrl, 'Fetch Request', ctxMeta());

                    const response = await origFetch.apply(this, args);
                    try {
                        const ct = (response.headers.get('content-type') || '').toLowerCase();
                        const respUrl = response.url || reqUrl;
                        const mediaMeta = metaFromContentType(ct);
                        if (mediaMeta) {
                            addMedia(respUrl, 'Fetch Response', Object.assign(ctxMeta(), mediaMeta));
                        }
                        if (ct.includes('mpegurl') || ct.includes('json') || ct.includes('text') || ct.includes('javascript')) {
                            const len = parseInt(response.headers.get('content-length') || '0', 10);
                            if (len < 3e6) {
                                response.clone().text().then(txt => {
                                    if (respUrl.includes('/youtubei/v1/player')) {
                                        parseYouTubePlayerData(txt, ctxMeta());
                                    }
                                    if (ct.includes('mpegurl') && isTop) {
                                        const q = parseM3u8Text(txt, respUrl);
                                        const it = found.get(respUrl);
                                        if (q && it) {
                                            it.qualities = q;
                                            if (isModalOpen()) renderItems();
                                        }
                                    }
                                    extractFromText(txt, 'Fetch Body Response', ctxMeta());
                                }).catch(() => {});
                            }
                        }
                    } catch {}
                    return response;
                };
            }
        } catch {}

        try {
            const XP = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
            if (XP) {
                const origOpen = XP.open;
                const origSend = XP.send;
                XP.open = function(method, url, ...rest) {
                    this.__vhUrl = url ? String(url) : '';
                    if (this.__vhUrl) addMedia(this.__vhUrl, 'XHR Request', ctxMeta());
                    return origOpen.call(this, method, url, ...rest);
                };
                XP.send = function(...args) {
                    this.addEventListener('load', function() {
                        try {
                            const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
                            const respUrl = this.responseURL || this.__vhUrl;
                            const mediaMeta = metaFromContentType(ct);
                            if (mediaMeta) {
                                addMedia(respUrl, 'XHR Response', Object.assign(ctxMeta(), mediaMeta));
                            }
                            if (!this.responseType || this.responseType === 'text') {
                                if (respUrl.includes('/youtubei/v1/player')) {
                                    parseYouTubePlayerData(this.responseText, ctxMeta());
                                }
                                if (ct.includes('mpegurl') && isTop) {
                                    const q = parseM3u8Text(this.responseText, respUrl);
                                    const it = found.get(respUrl);
                                    if (q && it) {
                                        it.qualities = q;
                                        if (isModalOpen()) renderItems();
                                    }
                                }
                                extractFromText(this.responseText, 'XHR Text Body', ctxMeta());
                            } else if (this.responseType === 'json' && this.response) {
                                const jsonStr = JSON.stringify(this.response);
                                if (respUrl.includes('/youtubei/v1/player')) {
                                    parseYouTubePlayerData(jsonStr, ctxMeta());
                                }
                                extractFromText(jsonStr, 'XHR JSON Body', ctxMeta());
                            }
                        } catch {}
                    });
                    return origSend.apply(this, args);
                };
            }
        } catch {}

        try {
            const U = w.URL;
            const origCOU = U && U.createObjectURL;
            if (typeof origCOU === 'function') {
                U.createObjectURL = function(obj) {
                    const url = origCOU.call(U, obj);
                    try {
                        if (obj instanceof w.Blob || (w.MediaSource && obj instanceof w.MediaSource)) {
                            addMedia(url, 'Blob / MediaSource', Object.assign(ctxMeta(), { forceType: 'BLOB' }));
                        }
                    } catch {}
                    return url;
                };
            }
        } catch {}

        try {
            const nav = w.navigator;
            if (nav && typeof nav.requestMediaKeySystemAccess === 'function') {
                const origEME = nav.requestMediaKeySystemAccess;
                nav.requestMediaKeySystemAccess = function(keySystem, ...rest) {
                    try { if (!stopped) drmSystems.add(String(keySystem).slice(0, 60)); } catch {}
                    return origEME.call(this, keySystem, ...rest);
                };
            }
        } catch {}
    }

    function reportMediaEl(el, label) {
        if (stopped) return;
        const tag = el.tagName;
        if (el.mediaKeys) drmSystems.add('mediaKeys attached');
        const src = el.currentSrc || el.src;
        if (!src) return;
        const res = (el.videoWidth && el.videoHeight) ? `${el.videoWidth}x${el.videoHeight}` : null;
        const dur = (el.duration && isFinite(el.duration)) ? `${Math.round(el.duration)}s` : null;
        const fallbackType = tag === 'VIDEO' ? 'DIRECT' : 'AUDIO';
        addMedia(src, `Tag <${tag.toLowerCase()}>`, { base: el.ownerDocument.baseURI, frame: label, videoEl: el, resolution: res, duration: dur, fallbackType });
    }

    function scanDOM(root, ctx) {
        if (!root || !root.querySelectorAll) return;
        const common = { base: ctx.doc.baseURI, frame: ctx.label };

        try {
            root.querySelectorAll(SELECTOR).forEach(el => {
                const tag = el.tagName;
                if (tag === 'VIDEO' || tag === 'AUDIO') {
                    reportMediaEl(el, ctx.label);
                    if (el.__vhWatched !== TOKEN) {
                        el.__vhWatched = TOKEN;
                        ['loadedmetadata', 'play', 'durationchange'].forEach(ev => el.addEventListener(ev, () => reportMediaEl(el, ctx.label)));
                    }
                } else if (tag === 'SOURCE') {
                    const parent = el.closest('video, audio');
                    const fallbackType = parent && parent.tagName === 'AUDIO' ? 'AUDIO' : 'DIRECT';
                    if (el.src) addMedia(el.src, 'Tag <source>', Object.assign({ videoEl: parent, fallbackType }, common));
                } else if (tag === 'IFRAME' || tag === 'FRAME') {
                    const src = el.src || el.dataset?.src || el.getAttribute('data-lazy-src');
                    const adLike = REGEX.adFrame.test(src || '');
                    const playerSized = el.clientWidth >= 320 && el.clientHeight >= 180;
                    let inner = null;
                    try { inner = el.contentDocument; } catch {}

                    if (src && !adLike && (REGEX.embed.test(src) || REGEX.iframePlayer.test(src) || playerSized)) {
                        addMedia(src, 'Tag <iframe>', Object.assign({ forceType: 'EMBED' }, common));
                    }
                    if (inner && !adLike) {
                        if (!frameNums.has(el)) frameNums.set(el, nextFrame++);
                        const lab = (ctx.label ? ctx.label + '/' : '') + 'frame' + frameNums.get(el);
                        scanDocument(inner, lab, ctx.depth + 1, ctx.full);
                    }
                } else {
                    ['href', 'data-src', 'data-video', 'data-mp4', 'data-url', 'data-stream', 'src', 'data'].forEach(attr => {
                        const val = el.getAttribute(attr);
                        if (val) addMedia(val, `Attribute [${attr}]`, common);
                    });
                }
            });

            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) scanDOM(el.shadowRoot, ctx);
            });
        } catch {}
    }

    function scanScripts(doc, label) {
        const meta = { base: doc.baseURI, frame: label };
        doc.querySelectorAll('script').forEach(s => {
            if (s.textContent) extractFromText(s.textContent, 'Inline <script>', meta);
        });

        try {
            const w = doc.defaultView;
            Object.keys(w).forEach(key => {
                if (/player|video|media|config|playlist|stream|hls|dash/i.test(key)) {
                    try {
                        const val = w[key];
                        if (typeof val === 'string') extractFromText(val, `Global Window.${key}`, meta);
                        else if (val && typeof val === 'object') extractFromText(JSON.stringify(val), `Global Window.${key}`, meta);
                    } catch {}
                }
            });
        } catch {}
    }

    function scanPerf(w, label) {
        try {
            w.performance.getEntriesByType('resource').forEach(res => addMedia(res.name, 'Network', { frame: label }));
        } catch {}
    }

    function scanDocument(doc, label, depth, full) {
        if (!doc || depth > MAX_DEPTH) return;
        const isNew = !attachedDocs.has(doc);
        attachDoc(doc, label);
        scanDOM(doc, { doc, label, depth, full });
        if (full || isNew) {
            scanScripts(doc, label);
            scanPerf(doc.defaultView, label);
        }
    }

    function attachDoc(doc, label) {
        if (attachedDocs.has(doc)) return;
        attachedDocs.add(doc);
        const w = doc.defaultView;
        if (!w) return;
        hookWindow(w, label);

        ['loadedmetadata', 'play', 'playing', 'durationchange'].forEach(ev => {
            doc.addEventListener(ev, e => {
                const t = e.target;
                if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) reportMediaEl(t, label);
            }, true);
        });

        try {
            const mo = new MutationObserver(() => {
                clearTimeout(domTimer);
                domTimer = setTimeout(() => scanAll(false), 400);
            });
            mo.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'href'] });
        } catch {}

        try {
            if (w.PerformanceObserver) {
                const po = new w.PerformanceObserver(list => {
                    list.getEntries().forEach(en => addMedia(en.name, 'Live Network', { frame: label }));
                });
                po.observe({ entryTypes: ['resource'] });
            }
        } catch {}
    }

    function scanAll(full) {
        if (stopped) return;
        scanDocument(document, '', 0, full);
    }

    function checkHotkeys(e) {
        const isEditing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
        const k = (e.key || '').toLowerCase();
        const c = e.code || '';

        const isAltV = e.altKey && (c === 'KeyV' || c === 'KeyD' || k === 'v' || k === 'м' || k === 'в');
        const isInsert = c === 'Insert' || k === 'insert';
        const isNumpad0 = c === 'Numpad0' || (k === '0' && e.location === 3) || (k === 'insert' && e.location === 3);

        if (isAltV || ((isInsert || isNumpad0) && !isEditing)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return true;
        }
        return false;
    }

    if (!isTop) {
        scanAll(true);
        window.addEventListener('keydown', e => {
            if (checkHotkeys(e)) {
                try { window.top.postMessage({ type: 'VH_TOGGLE_MODAL' }, '*'); } catch {}
            }
        }, true);
        return;
    }

    window.addEventListener('message', e => {
        if (e.data && e.data.type === 'VH_MEDIA_FOUND' && e.data.rawUrl) {
            addMedia(e.data.rawUrl, e.data.source || 'Child Frame', e.data.meta || {});
        } else if (e.data && e.data.type === 'VH_TOGGLE_MODAL') {
            toggleModal();
        }
    });

    let hostEl = null;
    let shadow = null;
    let modalEl = null;

    function createFloatingWindow() {
        if (hostEl) return;
        hostEl = document.createElement('div');
        hostEl.id = 'vh-float-host';
        hostEl.style.cssText = 'position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0; pointer-events: none;';
        shadow = hostEl.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = `
            .vh-floating {
                position: fixed;
                top: 24px;
                right: 24px;
                width: 440px;
                max-width: 90vw;
                height: 520px;
                max-height: 85vh;
                background: #09182b;
                border: 1.5px solid #00b4d8;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
                color: #e2e8f0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                overflow: hidden;
                box-sizing: border-box;
                pointer-events: auto;
            }
            .vh-bar {
                padding: 8px 12px;
                background: #0d213a;
                border-bottom: 1px solid rgba(0, 180, 216, 0.3);
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: grab;
                user-select: none;
            }
            .vh-bar:active {
                cursor: grabbing;
            }
            .vh-title {
                font-size: 13px;
                font-weight: 600;
                color: #00b4d8;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .vh-count {
                font-size: 11px;
                background: rgba(0, 180, 216, 0.2);
                padding: 1px 6px;
                border-radius: 10px;
            }
            .vh-controls {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .vh-btn {
                background: transparent;
                border: 1px solid rgba(0, 180, 216, 0.4);
                color: #00b4d8;
                border-radius: 4px;
                cursor: pointer;
                padding: 2px 7px;
                font-size: 11px;
                line-height: 1.2;
            }
            .vh-btn:hover {
                background: #00b4d8;
                color: #09182b;
            }
            .vh-body {
                flex: 1;
                overflow-y: auto;
                padding: 8px 10px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .vh-body::-webkit-scrollbar {
                width: 5px;
            }
            .vh-body::-webkit-scrollbar-thumb {
                background: rgba(0, 180, 216, 0.3);
                border-radius: 4px;
            }
            .vh-group {
                background: #0c1e33;
                border: 1px solid rgba(0, 180, 216, 0.15);
                border-radius: 5px;
                padding: 6px 8px;
            }
            .vh-group-head {
                font-size: 11px;
                font-weight: 600;
                margin-bottom: 5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .vh-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .vh-card {
                background: #071424;
                border: 1px solid rgba(255, 255, 255, 0.04);
                border-radius: 4px;
                padding: 5px 7px;
                font-size: 11px;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .vh-link-row {
                display: flex;
                align-items: center;
                gap: 6px;
                justify-content: space-between;
            }
            .vh-url {
                color: #38bdf8;
                text-decoration: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 330px;
            }
            .vh-url:hover {
                text-decoration: underline;
            }
            .vh-copy {
                background: transparent;
                border: none;
                color: #64748b;
                cursor: pointer;
                font-size: 11px;
                padding: 0 4px;
            }
            .vh-copy:hover {
                color: #00b4d8;
            }
            .vh-sub {
                color: #64748b;
                font-size: 10px;
                display: flex;
                gap: 6px;
            }
            .vh-qualities {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 3px;
            }
            .vh-pill {
                background: rgba(0, 180, 216, 0.15);
                border: 1px solid rgba(0, 180, 216, 0.35);
                color: #38bdf8;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 10px;
                text-decoration: none;
            }
            .vh-pill:hover {
                background: #00b4d8;
                color: #09182b;
            }
            .vh-empty {
                text-align: center;
                color: #64748b;
                margin: auto;
                font-size: 12px;
            }
            .vh-foot {
                padding: 5px 8px;
                border-top: 1px solid rgba(0, 180, 216, 0.2);
                text-align: center;
                font-size: 10px;
                color: #64748b;
                background: #081627;
                user-select: none;
            }
        `;
        shadow.appendChild(style);

        modalEl = document.createElement('div');
        modalEl.className = 'vh-floating';

        const savedPos = (() => {
            try {
                const raw = localStorage.getItem('vh_window_pos');
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        })();
        if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
            const maxX = Math.max(0, window.innerWidth - 100);
            const maxY = Math.max(0, window.innerHeight - 50);
            modalEl.style.left = `${Math.max(0, Math.min(savedPos.left, maxX))}px`;
            modalEl.style.top = `${Math.max(0, Math.min(savedPos.top, maxY))}px`;
            modalEl.style.right = 'auto';
        }

        setSafeHTML(modalEl, `
            <div class="vh-bar" id="vh-drag-handle">
                <div class="vh-title">
                    <span>VideoHunter</span>
                    <span class="vh-count" id="vh-total">0</span>
                </div>
                <div class="vh-controls">
                    <button class="vh-btn" id="vh-scan-btn" type="button">Scan</button>
                    <button class="vh-btn" id="vh-close-btn" type="button">✕</button>
                </div>
            </div>
            <div class="vh-body" id="vh-content"></div>
            <div class="vh-foot">Made By Islom Sadriddinov</div>
        `);

        setupDragging(modalEl, modalEl.querySelector('#vh-drag-handle'));
        modalEl.querySelector('#vh-close-btn').addEventListener('click', hideModal);
        modalEl.querySelector('#vh-scan-btn').addEventListener('click', () => {
            scanAll(true);
            renderItems();
        });

        shadow.appendChild(modalEl);
        (document.body || document.documentElement).appendChild(hostEl);
    }

    function setupDragging(target, handle) {
        let isDown = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;

        handle.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            isDown = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = target.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;

            target.style.left = `${origLeft}px`;
            target.style.top = `${origTop}px`;
            target.style.right = 'auto';
            e.preventDefault();
        });

        window.addEventListener('mousemove', e => {
            if (!isDown) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let nextX = origLeft + dx;
            let nextY = origTop + dy;

            const maxX = window.innerWidth - target.offsetWidth;
            const maxY = window.innerHeight - target.offsetHeight;

            nextX = Math.max(0, Math.min(nextX, maxX));
            nextY = Math.max(0, Math.min(nextY, maxY));

            target.style.left = `${nextX}px`;
            target.style.top = `${nextY}px`;
        });

        window.addEventListener('mouseup', () => {
            if (!isDown) return;
            isDown = false;
            try {
                const rect = target.getBoundingClientRect();
                localStorage.setItem('vh_window_pos', JSON.stringify({ left: rect.left, top: rect.top }));
            } catch {}
        });
    }

    function isModalOpen() {
        return hostEl && hostEl.style.display !== 'none';
    }

    function renderItems() {
        if (!shadow) return;
        const container = shadow.getElementById('vh-content');
        const totalBadge = shadow.getElementById('vh-total');
        if (!container) return;

        if (totalBadge) totalBadge.textContent = found.size;

        const by = {};
        found.forEach(i => {
            const k = catKey(i.type);
            (by[k] = by[k] || []).push(i);
        });

        if (!found.size) {
            setSafeHTML(container, '<div class="vh-empty">No media detected yet.</div>');
            return;
        }

        let html = '';
        CATS.forEach(([key, label, color]) => {
            const list = by[key];
            if (!list || !list.length) return;

            html += `
                <div class="vh-group">
                    <div class="vh-group-head" style="color: ${color}">
                        <span>${key} (${list.length})</span>
                    </div>
                    <div class="vh-list">
            `;

            list.forEach(item => {
                const metaParts = [];
                if (item.resolution) metaParts.push(item.resolution);
                if (item.duration) metaParts.push(item.duration);
                if (item.count > 1) metaParts.push(`×${item.count}`);

                let qualitiesHtml = '';
                if (item.qualities && item.qualities.length) {
                    qualitiesHtml = `<div class="vh-qualities">` +
                        item.qualities.map(q => `<a class="vh-pill" href="${q.url}" target="_blank" rel="noopener noreferrer">${q.resolution}</a>`).join('') +
                        `</div>`;
                }

                html += `
                    <div class="vh-card">
                        <div class="vh-link-row">
                            <a class="vh-url" href="${item.url}" target="_blank" rel="noopener noreferrer" title="${item.url}">${item.url}</a>
                            <button class="vh-copy" type="button" data-url="${item.url}" title="Copy">📋</button>
                        </div>
                        ${metaParts.length ? `<div class="vh-sub">${metaParts.join(' • ')}</div>` : ''}
                        ${qualitiesHtml}
                    </div>
                `;
            });

            html += '</div></div>';
        });

        setSafeHTML(container, html);

        container.querySelectorAll('.vh-copy').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetUrl = e.currentTarget.getAttribute('data-url');
                if (targetUrl) {
                    navigator.clipboard.writeText(targetUrl);
                    e.currentTarget.textContent = '✓';
                    setTimeout(() => { e.currentTarget.textContent = '📋'; }, 1200);
                }
            });
        });
    }

    function showModal() {
        scanAll(true);
        if (!hostEl) {
            createFloatingWindow();
        } else {
            hostEl.style.display = 'block';
        }
        renderItems();
    }

    function hideModal() {
        if (hostEl) hostEl.style.display = 'none';
    }

    function toggleModal() {
        if (isModalOpen()) hideModal();
        else showModal();
    }

    window.addEventListener('keydown', e => {
        if (checkHotkeys(e)) {
            toggleModal();
        } else if (e.key === 'Escape' && isModalOpen()) {
            hideModal();
        }
    }, true);

    scanAll(true);
})();

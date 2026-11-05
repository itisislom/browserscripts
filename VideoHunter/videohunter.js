// ==UserScript==
// @name         VideoHunter
// @namespace    https://tampermonkey.net/
// @version      3.0
// @description  Smart video & stream interceptor with live scanning, HLS downloader, and verified recording
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
    const FRAME_ID = Math.random().toString(36).slice(2, 10);

    let scanningActive = false;
    let nextId = 1;
    let nextFrame = 1;
    let nextRecTargetId = 1;
    let domTimer = null;
    let vhPolicy = null;
    let searchQuery = '';

    // Состояние записи (локальное и межфреймовое)
    let activeRecorder = null;
    let activeRecordBtn = null;
    let activeRecordItemId = null;
    let activeRecordFrameId = null;
    let activeRecordTimer = null;
    let activeRecordVideo = null;
    let activeRecordEndedHandler = null;

    const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'blob:', 'data:']);
    const MAX_ITEMS = 1000;
    const MAX_DEPTH = 6;
    const CATS = [
        ['DIRECT', 'Video files', '#10b981'],
        ['STREAM', 'Streams (HLS, DASH)', '#f59e0b'],
        ['BLOB', 'Blob / MediaSource', '#a855f7'],
        ['AUDIO', 'Audio', '#06b6d4'],
        ['EMBED', 'Iframe players', '#3b82f6'],
        ['CHUNKS', 'Segments', '#ec4899']
    ];

    const found = new Map();
    const rawSegments = new Set();
    const drmSystems = new Set();
    const attachedDocs = new WeakSet();
    const frameNums = new WeakMap();
    const localVideoTargets = new Map(); // recTargetId -> HTMLVideoElement
    const videoToTargetId = new WeakMap(); // HTMLVideoElement -> recTargetId

    const REGEX = {
        direct: /\.(mp4|webm|mkv|mov|avi|flv|ogv|3gp|m4v|wmv)$/i,
        stream: /\.(m3u8|mpd|f4m|ism\/manifest)$/i,
        streamInQuery: /\.(m3u8|mpd)(?![\w-])/i,
        segment: /\.(ts|m4s|cmfv|cmfa|mp4v|mp4a)$/i,
        audio: /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i,
        staticAsset: /\.(js|mjs|css|map|json|xml|txt|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot)$/i,
        manifestPath: /(^|\/)(manifest|playlist|master|index)\.(m3u8|mpd)([?#]|$)/i,
        rawUrl: /https?:\/\/[^\s"'\\<>]+?\.(mp4|webm|mkv|mov|m3u8|mpd|mp3|m4a|wav|flac)(?=[?#"'\\<>\s,;)]|$)(\?[^\s"'\\<>]+)?/gi,
        escapedUrl: /https?:\\\/\\\/[^\s"'<>]+?\.(mp4|webm|mkv|mov|m3u8|mpd|mp3|m4a)(?=[?#"'<>\s,;)]|\\u|$)(\?[^\s"'<>]+)?/gi,
        embed: /(youtube\.com\/embed|player\.vimeo|tiktok\.com\/embed|vk\.com\/video_ext|vkvideo\.ru\/video_ext|rutube\.ru\/play\/embed|dzen\.ru\/embed|ok\.ru\/videoembed|kinescope\.io|boomstream\.com|player\.twitch\.tv|mail\.ru\/video\/embed|kodik\.|aniqit\.|sibnet\.ru\/shell|vidsrc\.|filemoon\.|streamtape\.|dood\.)/i,
        iframePlayer: /embed|player|video/i,
        adFrame: /recaptcha|hcaptcha|doubleclick|googlesyndication|googletagmanager|adservice|challenges\.cloudflare|facebook\.com\/(plugins|tr)|platform\.twitter|disqus|yandex\.ru\/ads|an\.yandex\.ru/i
    };

    const SELECTOR = 'video, source, iframe, frame, audio, embed, object, a[href], [data-src], [data-video], [data-mp4], [data-url], [data-stream]';

    function getTrustedHTML(htmlString) {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
            if (!vhPolicy) {
                try {
                    vhPolicy = window.trustedTypes.createPolicy('vh-policy-' + Date.now(), {
                        createHTML: s => s
                    });
                } catch {
                    try { vhPolicy = window.trustedTypes.defaultPolicy; } catch {}
                }
            }
            if (vhPolicy) return vhPolicy.createHTML(htmlString);
        }
        return htmlString;
    }

    function setSafeHTML(element, htmlString) {
        element.innerHTML = getTrustedHTML(htmlString);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatBytes(bytes) {
        const b = Number(bytes);
        if (!b || b <= 0 || !isFinite(b)) return null;
        if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
        if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
        if (b >= 1024) return Math.round(b / 1024) + ' KB';
        return b + ' B';
    }

    function getSafePageTitle() {
        const raw = document.title || 'video';
        return raw.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'video';
    }

    function normalizeUrl(raw, base) {
        if (!raw || typeof raw !== 'string') return null;
        let u = raw.trim()
            .replace(/\\\//g, '/')
            .replace(/\\u0026/gi, '&')
            .replace(/\\u003d/gi, '=')
            .replace(/&amp;/g, '&');
        if (u.startsWith('//')) u = location.protocol + u;
        if (!/^(https?:|blob:|data:)/i.test(u)) {
            try { u = new URL(u, base || location.href).href; } catch { return null; }
        }
        return u;
    }

    // Точная проверка: можно ли реально записать данный <video> через MediaRecorder
    function canRecordVideo(videoEl) {
        if (!videoEl || videoEl.tagName !== 'VIDEO' || !videoEl.isConnected) return false;
        if (typeof MediaRecorder === 'undefined') return false;
        if (videoEl.mediaKeys) return false;
        // Видео должно иметь загруженные метаданные и реальные размеры кадра
        if (videoEl.readyState < 1 || !videoEl.videoWidth || !videoEl.videoHeight) return false;
        const captureFn = videoEl.captureStream || videoEl.mozCaptureStream;
        if (typeof captureFn !== 'function') return false;

        // Проверка на CORS taint (если поток с чужого домена без CORS, captureStream выбросит SecurityError)
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, 1, 1);
            ctx.getImageData(0, 0, 1, 1);
        } catch {
            return false;
        }
        return true;
    }

    function registerVideoTarget(videoEl) {
        if (!videoEl || videoEl.tagName !== 'VIDEO') return null;
        let id = videoToTargetId.get(videoEl);
        if (!id) {
            id = nextRecTargetId++;
            videoToTargetId.set(videoEl, id);
            localVideoTargets.set(id, videoEl);
        }
        return id;
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

        if (REGEX.stream.test(path) || REGEX.streamInQuery.test(parsed.search) || REGEX.manifestPath.test(path)) return 'STREAM';
        if (!meta.fallbackType && REGEX.staticAsset.test(path)) return null;
        if (REGEX.segment.test(path)) return 'CHUNKS';
        if (REGEX.audio.test(path)) return 'AUDIO';
        if (REGEX.direct.test(path)) return 'DIRECT';
        if (REGEX.embed.test(url)) return 'EMBED';
        return meta.fallbackType || null;
    }

    function catKey(type) {
        return type.split(' ')[0];
    }

    function newItem(o) {
        return Object.assign({
            id: nextId++,
            count: 1,
            videoEl: null,
            canRecord: false,
            recFrameId: null,
            recTargetId: null,
            resolution: null,
            duration: null,
            size: null,
            folder: null,
            qualities: null
        }, o);
    }

    function parseM3u8Text(text, baseUrl) {
        if (!text || !text.includes('#EXTM3U')) return null;
        const lines = text.split(/\r?\n/);
        const result = [];
        const seen = new Set();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
                const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
                let nextLine = '';
                for (let j = i + 1; j < lines.length; j++) {
                    const cand = lines[j].trim();
                    if (!cand) continue;
                    if (!cand.startsWith('#')) { nextLine = cand; i = j; break; }
                }
                if (nextLine) {
                    const absUrl = normalizeUrl(nextLine, baseUrl);
                    if (absUrl && !seen.has(absUrl)) {
                        seen.add(absUrl);
                        let label = resMatch ? resMatch[1] : (bwMatch ? Math.round(Number(bwMatch[1]) / 1000) + 'kbps' : 'stream');
                        if (resMatch) {
                            const h = resMatch[1].split('x')[1];
                            if (h) label = `${h}p (${resMatch[1]})`;
                        }
                        result.push({ resolution: label, url: absUrl });
                    }
                }
            }
        }
        return result.length ? result : null;
    }

    function parseMpdText(text) {
        if (!text || !text.includes('<MPD')) return null;
        const result = [];
        const seen = new Set();
        const repRegex = /<Representation\b([^>]*)>/gi;
        let m;
        while ((m = repRegex.exec(text)) !== null) {
            const attrs = m[1];
            const w = (attrs.match(/\bwidth="(\d+)"/i) || [])[1];
            const h = (attrs.match(/\bheight="(\d+)"/i) || [])[1];
            if (w && h) {
                const label = `${h}p (${w}x${h})`;
                if (!seen.has(label)) {
                    seen.add(label);
                    result.push({ resolution: label, url: null });
                }
            }
        }
        return result.length ? result : null;
    }

    async function fetchWithFallback(url) {
        try {
            const r1 = await fetch(url);
            if (r1.ok) return r1;
        } catch {}
        return fetch(url, { credentials: 'omit' });
    }

    async function inspectManifest(url, item) {
        if (!url || item.qualities) return;
        const isM3u8 = url.includes('.m3u8');
        const isMpd = url.includes('.mpd');
        if (!isM3u8 && !isMpd) return;
        try {
            const resp = await fetchWithFallback(url);
            if (!resp.ok) return;
            const text = await resp.text();
            if (!scanningActive) return;
            const q = isM3u8 ? parseM3u8Text(text, url) : parseMpdText(text);
            if (q) {
                item.qualities = q;
                if (isTop && isModalOpen()) renderItems();
            }
        } catch {}
    }

    // Привязка найденных потоков к активному <video>, если на странице играет один плеер
    function syncRecordableState(item) {
        if (item.videoEl) {
            const ok = canRecordVideo(item.videoEl);
            item.canRecord = ok;
            if (ok) {
                item.recFrameId = FRAME_ID;
                item.recTargetId = registerVideoTarget(item.videoEl);
            }
        }
    }

    function addMedia(rawUrl, source, meta = {}) {
        if (!scanningActive) return;
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

        if (meta.videoEl) {
            const canRec = canRecordVideo(meta.videoEl);
            meta.canRecord = canRec;
            if (canRec) {
                meta.recFrameId = FRAME_ID;
                meta.recTargetId = registerVideoTarget(meta.videoEl);
            }
        }

        if (!isTop) {
            try {
                window.top.postMessage({
                    type: 'VH_MEDIA_FOUND',
                    rawUrl: url,
                    source: `[${location.hostname}] ${source}`,
                    meta: {
                        resolution: meta.resolution || null,
                        duration: meta.duration || null,
                        size: meta.size || null,
                        forceType: meta.forceType || null,
                        fallbackType: meta.fallbackType || null,
                        canRecord: Boolean(meta.canRecord),
                        recFrameId: meta.recFrameId || null,
                        recTargetId: meta.recTargetId || null
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
            existing = newItem({
                type,
                source,
                url,
                videoEl: meta.videoEl || null,
                canRecord: Boolean(meta.canRecord),
                recFrameId: meta.recFrameId || null,
                recTargetId: meta.recTargetId || null,
                resolution: meta.resolution || null,
                duration: meta.duration || null,
                size: meta.size || null
            });
            found.set(url, existing);
            if (type.startsWith('STREAM')) inspectManifest(url, existing);
            if (isModalOpen()) renderItems();
            return;
        }

        let changed = false;
        if (meta.videoEl && !existing.videoEl) {
            existing.videoEl = meta.videoEl;
            changed = true;
        }
        if (meta.canRecord && !existing.canRecord) {
            existing.canRecord = true;
            existing.recFrameId = meta.recFrameId;
            existing.recTargetId = meta.recTargetId;
            changed = true;
        }
        if (meta.resolution && existing.resolution !== meta.resolution) {
            existing.resolution = meta.resolution;
            changed = true;
        }
        if (meta.duration && existing.duration !== meta.duration) {
            existing.duration = meta.duration;
            changed = true;
        }
        if (meta.size && !existing.size) {
            existing.size = meta.size;
            changed = true;
        }
        if (changed && isModalOpen()) renderItems();
    }

    function extractFromText(text, sourceLabel, meta) {
        if (!scanningActive || !text || typeof text !== 'string' || text.length > 600000) return;
        const m1 = text.match(REGEX.rawUrl) || [];
        const m2 = text.match(REGEX.escapedUrl) || [];
        [...m1, ...m2].forEach(match => addMedia(match, sourceLabel, meta));
    }

    function metaFromContentType(ct, contentLength) {
        const size = formatBytes(contentLength);
        if (ct.includes('mpegurl') || ct.includes('dash+xml') || ct.includes('vnd.apple.mpegurl')) {
            return { forceType: 'STREAM', size };
        }
        if (ct.includes('mp2t') || ct.includes('iso.segment')) {
            return { forceType: 'CHUNKS', size };
        }
        if (ct.startsWith('video/')) {
            return { fallbackType: 'DIRECT', size };
        }
        if (ct.startsWith('audio/')) {
            return { fallbackType: 'AUDIO', size };
        }
        return null;
    }

    function parseYouTubePlayerData(jsonText, ctxMeta) {
        if (!scanningActive) return;
        try {
            const data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
            const sd = data && (data.streamingData || data.playerResponse?.streamingData);
            if (sd) {
                if (sd.hlsManifestUrl) addMedia(sd.hlsManifestUrl, 'YouTube HLS', Object.assign({}, ctxMeta, { forceType: 'STREAM' }));
                if (sd.dashManifestUrl) addMedia(sd.dashManifestUrl, 'YouTube DASH', Object.assign({}, ctxMeta, { forceType: 'STREAM' }));
                const formats = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
                formats.forEach(f => {
                    if (f.url) {
                        const isAudio = (f.mimeType || '').includes('audio');
                        const res = f.qualityLabel || (isAudio ? 'Audio' : null);
                        const size = formatBytes(f.contentLength);
                        addMedia(f.url, 'YouTube Stream API', Object.assign({}, ctxMeta, {
                            resolution: res,
                            size,
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
                    if (scanningActive && reqUrl) addMedia(reqUrl, 'Fetch Request', ctxMeta());

                    const response = await origFetch.apply(this, args);
                    if (scanningActive) {
                        try {
                            const ct = (response.headers.get('content-type') || '').toLowerCase();
                            const cl = response.headers.get('content-length');
                            const respUrl = response.url || reqUrl;
                            const mediaMeta = metaFromContentType(ct, cl);
                            if (mediaMeta) {
                                addMedia(respUrl, 'Fetch Response', Object.assign(ctxMeta(), mediaMeta));
                            }
                            if (ct.includes('mpegurl') || ct.includes('dash+xml') || ct.includes('json') || ct.includes('text') || ct.includes('javascript')) {
                                const len = parseInt(cl || '0', 10);
                                if (len < 3e6) {
                                    response.clone().text().then(txt => {
                                        if (!scanningActive) return;
                                        if (respUrl && respUrl.includes('/youtubei/v1/player')) {
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
                                        extractFromText(txt, 'Fetch Body', ctxMeta());
                                    }).catch(() => {});
                                }
                            }
                        } catch {}
                    }
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
                    if (scanningActive && this.__vhUrl) addMedia(this.__vhUrl, 'XHR Request', ctxMeta());
                    return origOpen.call(this, method, url, ...rest);
                };
                XP.send = function(...args) {
                    this.addEventListener('load', function() {
                        if (!scanningActive) return;
                        try {
                            const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
                            const cl = this.getResponseHeader('content-length');
                            const respUrl = this.responseURL || this.__vhUrl;
                            const mediaMeta = metaFromContentType(ct, cl);
                            if (mediaMeta) {
                                addMedia(respUrl, 'XHR Response', Object.assign(ctxMeta(), mediaMeta));
                            }
                            if (!this.responseType || this.responseType === 'text') {
                                if (respUrl && respUrl.includes('/youtubei/v1/player')) {
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
                                extractFromText(this.responseText, 'XHR Body', ctxMeta());
                            } else if (this.responseType === 'json' && this.response) {
                                if (respUrl && respUrl.includes('/youtubei/v1/player')) {
                                    parseYouTubePlayerData(this.response, ctxMeta());
                                }
                                extractFromText(JSON.stringify(this.response), 'XHR JSON', ctxMeta());
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
                    if (scanningActive) {
                        try {
                            if (obj instanceof w.Blob || (w.MediaSource && obj instanceof w.MediaSource)) {
                                addMedia(url, 'Blob / MediaSource', Object.assign(ctxMeta(), { forceType: 'BLOB' }));
                            }
                        } catch {}
                    }
                    return url;
                };
            }
        } catch {}

        try {
            const nav = w.navigator;
            if (nav && typeof nav.requestMediaKeySystemAccess === 'function') {
                const origEME = nav.requestMediaKeySystemAccess;
                nav.requestMediaKeySystemAccess = function(keySystem, ...rest) {
                    try { if (scanningActive) drmSystems.add(String(keySystem).slice(0, 60)); } catch {}
                    return origEME.call(this, keySystem, ...rest);
                };
            }
        } catch {}
    }

    function reportMediaEl(el, label) {
        if (!scanningActive) return;
        const tag = el.tagName;
        if (el.mediaKeys) drmSystems.add('mediaKeys attached');
        const src = el.currentSrc || el.src;
        if (!src) return;
        const res = (el.videoWidth && el.videoHeight) ? `${el.videoWidth}x${el.videoHeight}` : null;
        const dur = (el.duration && isFinite(el.duration) && el.duration > 0) ? `${Math.round(el.duration)}s` : null;
        const fallbackType = tag === 'VIDEO' ? 'DIRECT' : 'AUDIO';
        addMedia(src, `Tag <${tag.toLowerCase()}>`, {
            base: el.ownerDocument.baseURI,
            frame: label,
            videoEl: tag === 'VIDEO' ? el : null,
            resolution: res,
            duration: dur,
            fallbackType
        });
    }

    function scanDOM(root, ctx) {
        if (!scanningActive || !root || !root.querySelectorAll) return;
        const common = { base: ctx.doc.baseURI, frame: ctx.label };

        try {
            root.querySelectorAll(SELECTOR).forEach(el => {
                const tag = el.tagName;
                if (tag === 'VIDEO' || tag === 'AUDIO') {
                    reportMediaEl(el, ctx.label);
                    if (el.__vhWatched !== TOKEN) {
                        el.__vhWatched = TOKEN;
                        ['loadedmetadata', 'loadeddata', 'play', 'playing', 'resize', 'durationchange'].forEach(ev =>
                            el.addEventListener(ev, () => reportMediaEl(el, ctx.label))
                        );
                    }
                } else if (tag === 'SOURCE') {
                    const parent = el.closest('video, audio');
                    const isVideo = parent && parent.tagName === 'VIDEO';
                    const fallbackType = parent && parent.tagName === 'AUDIO' ? 'AUDIO' : 'DIRECT';
                    if (el.src) addMedia(el.src, 'Tag <source>', Object.assign({ videoEl: isVideo ? parent : null, fallbackType }, common));
                } else if (tag === 'IFRAME' || tag === 'FRAME') {
                    const src = el.src || el.dataset?.src || el.getAttribute('data-lazy-src');
                    const adLike = REGEX.adFrame.test(src || '');
                    const playerSized = el.clientWidth >= 300 && el.clientHeight >= 160;
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
        if (!scanningActive) return;
        const meta = { base: doc.baseURI, frame: label };
        doc.querySelectorAll('script').forEach(s => {
            if (s.textContent) extractFromText(s.textContent, 'Inline <script>', meta);
        });

        try {
            const w = doc.defaultView;
            if (w.ytInitialPlayerResponse) {
                parseYouTubePlayerData(w.ytInitialPlayerResponse, meta);
            }
            Object.keys(w).forEach(key => {
                if (/player|video|media|config|playlist|stream|hls|dash/i.test(key)) {
                    try {
                        const val = w[key];
                        if (typeof val === 'string') extractFromText(val, `Window.${key}`, meta);
                        else if (val && typeof val === 'object') extractFromText(JSON.stringify(val), `Window.${key}`, meta);
                    } catch {}
                }
            });
        } catch {}
    }

    function scanPerf(w, label) {
        if (!scanningActive) return;
        try {
            w.performance.getEntriesByType('resource').forEach(res => {
                addMedia(res.name, 'Network', {
                    frame: label,
                    size: formatBytes(res.decodedBodySize || res.transferSize)
                });
            });
        } catch {}
    }

    function scanDocument(doc, label, depth, full) {
        if (!doc || depth > MAX_DEPTH) return;
        attachDoc(doc, label);
        if (!scanningActive) return;
        scanDOM(doc, { doc, label, depth, full });
        if (full) {
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

        ['loadedmetadata', 'loadeddata', 'play', 'playing', 'resize', 'durationchange'].forEach(ev => {
            doc.addEventListener(ev, e => {
                if (!scanningActive) return;
                const t = e.target;
                if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) reportMediaEl(t, label);
            }, true);
        });

        try {
            const mo = new MutationObserver(() => {
                if (!scanningActive) return;
                clearTimeout(domTimer);
                domTimer = setTimeout(() => scanAll(false), 350);
            });
            mo.observe(doc.documentElement || doc, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'data-src', 'href']
            });
        } catch {}

        try {
            if (w.PerformanceObserver) {
                const po = new w.PerformanceObserver(list => {
                    if (!scanningActive) return;
                    list.getEntries().forEach(en => addMedia(en.name, 'Live Network', {
                        frame: label,
                        size: formatBytes(en.decodedBodySize || en.transferSize)
                    }));
                });
                po.observe({ entryTypes: ['resource'] });
            }
        } catch {}
    }

    function scanAll(full) {
        if (!scanningActive) return;
        scanDocument(document, '', 0, full);
    }

    function resetSessionData() {
        found.clear();
        rawSegments.clear();
        drmSystems.clear();
        localVideoTargets.clear();
        nextId = 1;
    }

    function clearPerformanceHistory() {
        try {
            if (window.performance && typeof window.performance.clearResourceTimings === 'function') {
                window.performance.clearResourceTimings();
            }
        } catch {}
    }

    function broadcastToFrames(win, msg, depth = 0) {
        if (!win || depth > MAX_DEPTH) return;
        try {
            for (let i = 0; i < win.frames.length; i++) {
                try {
                    win.frames[i].postMessage(msg, '*');
                    broadcastToFrames(win.frames[i], msg, depth + 1);
                } catch {}
            }
        } catch {}
    }

    function checkHotkeys(e) {
        const path = e.composedPath ? e.composedPath() : [];
        const isEditing = path.some(el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) ||
                          ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
        if (isEditing) return false;

        const k = (e.key || '').toLowerCase();
        const c = e.code || '';

        const isAltV = e.altKey && (c === 'KeyV' || c === 'KeyD' || k === 'v' || k === 'м' || k === 'в');
        const isInsert = c === 'Insert' || k === 'insert';
        const isNumpad0 = c === 'Numpad0' || (k === '0' && e.location === 3) || (k === 'insert' && e.location === 3);

        if (isAltV || isInsert || isNumpad0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return true;
        }
        return false;
    }

    // Параллельное скачивание HLS (.m3u8) с поддержкой #EXT-X-MAP и AES-128
    async function downloadHlsStream(m3u8Url, btn) {
        const origText = btn.textContent;
        try {
            btn.disabled = true;
            btn.textContent = '⏳ Playlist...';

            const resp = await fetchWithFallback(m3u8Url);
            if (!resp.ok) throw new Error('Status ' + resp.status);
            const text = await resp.text();
            let lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let targetPlaylist = m3u8Url;

            // Если это Master-плейлист, выбираем поток с максимальным BANDWIDTH / разрешением
            const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF:'));
            if (isMaster) {
                let bestBw = -1;
                let bestUrl = null;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
                        const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/i);
                        const bw = bwMatch ? Number(bwMatch[1]) : 0;
                        const next = lines[i + 1];
                        if (next && !next.startsWith('#')) {
                            const cand = normalizeUrl(next, m3u8Url);
                            if (cand && bw >= bestBw) {
                                bestBw = bw;
                                bestUrl = cand;
                            }
                        }
                    }
                }
                if (bestUrl) {
                    targetPlaylist = bestUrl;
                    const subResp = await fetchWithFallback(targetPlaylist);
                    if (!subResp.ok) throw new Error('Sub-playlist error');
                    lines = (await subResp.text()).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                }
            }

            let initMapUrl = null;
            let aesKeyUri = null;
            let aesIvHex = null;
            let mediaSeq = 0;
            const segmentUrls = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                    mediaSeq = parseInt(line.split(':')[1] || '0', 10) || 0;
                } else if (line.startsWith('#EXT-X-MAP:')) {
                    const m = line.match(/URI="([^"]+)"/i);
                    if (m) initMapUrl = normalizeUrl(m[1], targetPlaylist);
                } else if (line.startsWith('#EXT-X-KEY:')) {
                    if (line.includes('METHOD=AES-128')) {
                        const km = line.match(/URI="([^"]+)"/i);
                        const ivm = line.match(/IV=0x([0-9a-fA-F]+)/i);
                        if (km) aesKeyUri = normalizeUrl(km[1], targetPlaylist);
                        if (ivm) aesIvHex = ivm[1];
                    } else if (line.includes('METHOD=SAMPLE-AES')) {
                        throw new Error('DRM Protected');
                    }
                } else if (!line.startsWith('#')) {
                    const segUrl = normalizeUrl(line, targetPlaylist);
                    if (segUrl) segmentUrls.push(segUrl);
                }
            }

            if (!segmentUrls.length) throw new Error('No segments');

            let cryptoKey = null;
            if (aesKeyUri && window.crypto && window.crypto.subtle) {
                const keyResp = await fetchWithFallback(aesKeyUri);
                const keyBuf = await keyResp.arrayBuffer();
                cryptoKey = await window.crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
            }

            const results = new Array(segmentUrls.length);
            let completed = 0;
            let cursor = 0;
            const CONCURRENCY = 6;

            async function decryptSegment(buf, seqIndex) {
                if (!cryptoKey) return buf;
                const iv = new Uint8Array(16);
                if (aesIvHex && aesIvHex.length === 32) {
                    for (let b = 0; b < 16; b++) iv[b] = parseInt(aesIvHex.slice(b * 2, b * 2 + 2), 16);
                } else {
                    const view = new DataView(iv.buffer);
                    view.setUint32(12, mediaSeq + seqIndex, false);
                }
                return window.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, buf);
            }

            let initSegmentBuf = null;
            if (initMapUrl) {
                const mapResp = await fetchWithFallback(initMapUrl);
                if (mapResp.ok) initSegmentBuf = await mapResp.arrayBuffer();
            }

            async function worker() {
                while (cursor < segmentUrls.length) {
                    const idx = cursor++;
                    const segResp = await fetchWithFallback(segmentUrls[idx]);
                    if (!segResp.ok) throw new Error('Segment ' + idx + ' error');
                    const rawBuf = await segResp.arrayBuffer();
                    results[idx] = await decryptSegment(rawBuf, idx);
                    completed++;
                    const pct = Math.round((completed / segmentUrls.length) * 100);
                    btn.textContent = `⏳ ${completed}/${segmentUrls.length} (${pct}%)`;
                }
            }

            const workers = Array.from({ length: Math.min(CONCURRENCY, segmentUrls.length) }, () => worker());
            await Promise.all(workers);

            btn.textContent = '💾 Saving...';
            const finalChunks = initSegmentBuf ? [initSegmentBuf, ...results] : results;
            const ext = initSegmentBuf ? 'mp4' : 'ts';
            const mime = initSegmentBuf ? 'video/mp4' : 'video/mp2t';
            const blob = new Blob(finalChunks, { type: mime });
            const dlUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = `${getSafePageTitle()}_${Date.now()}.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(dlUrl), 30000);

            btn.textContent = '✓ Done';
            setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        } catch (err) {
            btn.textContent = err.message === 'DRM Protected' ? '🔒 DRM' : '✕ Error';
            setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2500);
        }
    }

    function getOptimalRecordMime() {
        const candidates = [
            { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
            { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
            { mime: 'video/mp4', ext: 'mp4' },
            { mime: 'video/webm;codecs=h264,opus', ext: 'webm' },
            { mime: 'video/webm;codecs=h264', ext: 'webm' },
            { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
            { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
            { mime: 'video/webm', ext: 'webm' }
        ];
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
            for (const c of candidates) {
                if (MediaRecorder.isTypeSupported(c.mime)) return c;
            }
        }
        return { mime: '', ext: 'webm' };
    }

    function stopLocalRecording(isError = false) {
        if (activeRecordTimer) {
            clearInterval(activeRecordTimer);
            activeRecordTimer = null;
        }
        if (activeRecordVideo && activeRecordEndedHandler) {
            activeRecordVideo.removeEventListener('ended', activeRecordEndedHandler);
            activeRecordVideo = null;
            activeRecordEndedHandler = null;
        }
        if (activeRecorder) {
            try {
                if (activeRecorder.state !== 'inactive') activeRecorder.stop();
            } catch {}
            activeRecorder = null;
        }
        if (!isTop) {
            try {
                window.top.postMessage({ type: 'VH_REC_STATUS', state: isError ? 'error' : 'stopped', frameId: FRAME_ID }, '*');
            } catch {}
        } else {
            resetRecordButtonUI(isError);
        }
    }

    function resetRecordButtonUI(isError = false) {
        activeRecordItemId = null;
        activeRecordFrameId = null;
        if (activeRecordBtn) {
            const btnRef = activeRecordBtn;
            btnRef.textContent = isError ? '✕ Error' : '⏺ Rec';
            btnRef.disabled = false;
            activeRecordBtn = null;
            if (isError) {
                setTimeout(() => { btnRef.textContent = '⏺ Rec'; }, 2000);
            }
        }
    }

    function startLocalRecording(targetVideo) {
        if (!canRecordVideo(targetVideo)) {
            stopLocalRecording(true);
            return false;
        }

        try {
            let stream = null;
            if (typeof targetVideo.captureStream === 'function') {
                try { stream = targetVideo.captureStream(60); } catch { stream = targetVideo.captureStream(); }
            } else if (typeof targetVideo.mozCaptureStream === 'function') {
                try { stream = targetVideo.mozCaptureStream(60); } catch { stream = targetVideo.mozCaptureStream(); }
            }

            if (!stream || !stream.getVideoTracks().length) {
                stopLocalRecording(true);
                return false;
            }

            stream.getAudioTracks().forEach(t => { t.enabled = true; });

            const opt = getOptimalRecordMime();
            const h = targetVideo.videoHeight || 720;
            const videoBps = h >= 1440 ? 8000000 : (h >= 1080 ? 5000000 : (h >= 720 ? 3000000 : 2000000));

            const recorderOptions = {
                videoBitsPerSecond: videoBps,
                audioBitsPerSecond: 128000
            };
            if (opt.mime) recorderOptions.mimeType = opt.mime;

            const rec = new MediaRecorder(stream, recorderOptions);
            const chunks = [];
            let totalBytes = 0;
            const startSec = Date.now();

            rec.ondataavailable = e => {
                if (e.data && e.data.size > 0) {
                    chunks.push(e.data);
                    totalBytes += e.data.size;
                }
            };

            rec.onerror = () => stopLocalRecording(true);

            rec.onstop = () => {
                if (activeRecordTimer) {
                    clearInterval(activeRecordTimer);
                    activeRecordTimer = null;
                }
                if (!chunks.length) return;
                const finalType = opt.mime ? opt.mime.split(';')[0] : 'video/webm';
                const blob = new Blob(chunks, { type: finalType });
                const href = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = href;
                a.download = `${getSafePageTitle()}_rec_${Date.now()}.${opt.ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(href), 30000);
            };

            rec.start(1000);
            activeRecorder = rec;
            activeRecordVideo = targetVideo;

            activeRecordEndedHandler = () => stopLocalRecording(false);
            targetVideo.addEventListener('ended', activeRecordEndedHandler, { once: true });

            const updateTick = () => {
                const elapsed = Math.floor((Date.now() - startSec) / 1000);
                const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const ss = String(elapsed % 60).padStart(2, '0');
                const mb = (totalBytes / 1048576).toFixed(1);
                const label = `⏹ ${mm}:${ss} (${mb}MB)`;
                if (isTop) {
                    if (activeRecordBtn) activeRecordBtn.textContent = label;
                } else {
                    try {
                        window.top.postMessage({ type: 'VH_REC_STATUS', state: 'recording', label, frameId: FRAME_ID }, '*');
                    } catch {}
                }
            };

            updateTick();
            activeRecordTimer = setInterval(updateTick, 1000);
            return true;
        } catch {
            stopLocalRecording(true);
            return false;
        }
    }

    function handleRecClick(item, btn) {
        // Если уже идёт запись — останавливаем
        if (activeRecordItemId !== null) {
            if (activeRecordFrameId === FRAME_ID) {
                stopLocalRecording(false);
            } else {
                broadcastToFrames(window, { type: 'VH_CMD_STOP_REC', frameId: activeRecordFrameId });
                resetRecordButtonUI(false);
            }
            return;
        }

        if (!item || !item.canRecord) return;

        activeRecordBtn = btn;
        activeRecordItemId = item.id;
        activeRecordFrameId = item.recFrameId;

        if (item.recFrameId === FRAME_ID) {
            const v = item.videoEl || localVideoTargets.get(item.recTargetId);
            startLocalRecording(v);
        } else {
            btn.textContent = '⏳ Starting...';
            broadcastToFrames(window, {
                type: 'VH_CMD_START_REC',
                frameId: item.recFrameId,
                recTargetId: item.recTargetId
            });
        }
    }

    // Логика для дочерних фреймов (iframe)
    if (!isTop) {
        attachDoc(document, '');

        window.addEventListener('message', e => {
            const d = e.data;
            if (!d || typeof d !== 'object') return;

            if (d.type === 'VH_SET_SCANNING') {
                scanningActive = Boolean(d.active);
                if (scanningActive) {
                    scanAll(true);
                } else {
                    if (activeRecorder) stopLocalRecording(false);
                    localVideoTargets.clear();
                    clearPerformanceHistory();
                }
            } else if (d.type === 'VH_CMD_START_REC' && d.frameId === FRAME_ID) {
                const targetVideo = localVideoTargets.get(d.recTargetId);
                startLocalRecording(targetVideo);
            } else if (d.type === 'VH_CMD_STOP_REC' && d.frameId === FRAME_ID) {
                stopLocalRecording(false);
            }
        });

        window.addEventListener('keydown', e => {
            if (checkHotkeys(e)) {
                try { window.top.postMessage({ type: 'VH_TOGGLE_MODAL' }, '*'); } catch {}
            }
        }, true);
        return;
    }

    // Приём сообщений в главном окне (Top Window)
    window.addEventListener('message', e => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;

        if (d.type === 'VH_MEDIA_FOUND' && d.rawUrl && scanningActive) {
            addMedia(d.rawUrl, d.source || 'Child Frame', d.meta || {});
        } else if (d.type === 'VH_TOGGLE_MODAL') {
            toggleModal();
        } else if (d.type === 'VH_REC_STATUS' && d.frameId === activeRecordFrameId) {
            if (d.state === 'recording' && activeRecordBtn) {
                activeRecordBtn.textContent = d.label;
            } else if (d.state === 'stopped' || d.state === 'error') {
                resetRecordButtonUI(d.state === 'error');
            }
        }
    });

    let hostEl = null;
    let shadow = null;
    let modalEl = null;

    function getHostParent() {
        return document.fullscreenElement || document.body || document.documentElement;
    }

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
                width: 500px;
                max-width: 94vw;
                height: 560px;
                max-height: 88vh;
                background: #09182b;
                border: 1.5px solid #00b4d8;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
                color: #e2e8f0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                overflow: hidden;
                box-sizing: border-box;
                pointer-events: auto;
            }
            .vh-bar {
                padding: 7px 10px;
                background: #0d213a;
                border-bottom: 1px solid rgba(0, 180, 216, 0.3);
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: grab;
                user-select: none;
            }
            .vh-bar:active { cursor: grabbing; }
            .vh-title {
                font-size: 13px;
                font-weight: 600;
                color: #00b4d8;
                display: flex;
                align-items: center;
                gap: 5px;
                white-space: nowrap;
            }
            .vh-live-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #10b981;
                box-shadow: 0 0 6px #10b981;
            }
            .vh-count {
                font-size: 11px;
                background: rgba(0, 180, 216, 0.2);
                padding: 1px 6px;
                border-radius: 10px;
            }
            .vh-search {
                flex: 1;
                background: #071526;
                border: 1px solid rgba(0, 180, 216, 0.3);
                border-radius: 4px;
                padding: 2px 7px;
                color: #e2e8f0;
                font-size: 11px;
                outline: none;
                user-select: text;
                -webkit-user-select: text;
                cursor: text;
                min-width: 60px;
            }
            .vh-search:focus {
                border-color: #00b4d8;
                box-shadow: 0 0 4px rgba(0, 180, 216, 0.4);
            }
            .vh-controls {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .vh-btn {
                background: transparent;
                border: 1px solid rgba(0, 180, 216, 0.4);
                color: #00b4d8;
                border-radius: 4px;
                cursor: pointer;
                padding: 2px 6px;
                font-size: 11px;
                line-height: 1.2;
                white-space: nowrap;
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
            .vh-body::-webkit-scrollbar { width: 5px; }
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
                gap: 5px;
            }
            .vh-card {
                background: #071424;
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                padding: 6px 8px;
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
                flex: 1;
            }
            .vh-url:hover { text-decoration: underline; }
            .vh-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                flex-shrink: 0;
            }
            .vh-action-btn {
                background: rgba(0, 180, 216, 0.1);
                border: 1px solid rgba(0, 180, 216, 0.3);
                color: #00b4d8;
                border-radius: 3px;
                cursor: pointer;
                font-size: 10px;
                padding: 1px 5px;
                line-height: 1.2;
                text-decoration: none;
            }
            .vh-action-btn:hover {
                background: #00b4d8;
                color: #09182b;
            }
            .vh-btn-rec {
                border-color: rgba(239, 68, 68, 0.5);
                color: #f87171;
                background: rgba(239, 68, 68, 0.12);
            }
            .vh-btn-rec:hover {
                background: #ef4444;
                color: #fff;
            }
            .vh-sub {
                color: #64748b;
                font-size: 10px;
                display: flex;
                flex-wrap: wrap;
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
                cursor: pointer;
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
                    <span class="vh-live-dot" title="Scanning active"></span>
                    <span>VideoHunter</span>
                    <span class="vh-count" id="vh-total">0</span>
                </div>
                <input class="vh-search" id="vh-filter-input" type="search" placeholder="Filter..." autocomplete="off" spellcheck="false" />
                <div class="vh-controls">
                    <button class="vh-btn" id="vh-scan-btn" type="button" title="Clear and rescan current page">Rescan</button>
                    <button class="vh-btn" id="vh-close-btn" type="button" title="Close and clear">✕</button>
                </div>
            </div>
            <div class="vh-body" id="vh-content"></div>
            <div class="vh-foot">Made By Islom Sadriddinov</div>
        `);

        setupDragging(modalEl, modalEl.querySelector('#vh-drag-handle'));
        modalEl.querySelector('#vh-close-btn').addEventListener('click', hideModal);
        modalEl.querySelector('#vh-scan-btn').addEventListener('click', () => {
            startFreshScanSession();
        });

        const filterInput = modalEl.querySelector('#vh-filter-input');
        filterInput.addEventListener('input', e => {
            e.stopPropagation();
            searchQuery = (e.target.value || '').toLowerCase().trim();
            renderItems();
        });
        filterInput.addEventListener('search', () => {
            searchQuery = (filterInput.value || '').toLowerCase().trim();
            renderItems();
        });
        filterInput.addEventListener('keydown', e => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                if (filterInput.value) {
                    filterInput.value = '';
                    searchQuery = '';
                    renderItems();
                } else {
                    hideModal();
                }
            }
        });
        ['keyup', 'keypress', 'mousedown', 'pointerdown', 'click'].forEach(ev => {
            filterInput.addEventListener(ev, e => e.stopPropagation());
        });

        shadow.appendChild(modalEl);
        getHostParent().appendChild(hostEl);
    }

    function setupDragging(target, handle) {
        let isDown = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;

        handle.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
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

            const maxX = Math.max(0, window.innerWidth - target.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - target.offsetHeight);

            target.style.left = `${Math.max(0, Math.min(origLeft + dx, maxX))}px`;
            target.style.top = `${Math.max(0, Math.min(origTop + dy, maxY))}px`;
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
        return Boolean(hostEl && hostEl.style.display !== 'none');
    }

    function shellArg(url) {
        return '"' + String(url).replace(/["`$\\]/g, c => '\\' + c) + '"';
    }

    function buildYtDlpCmd(url) {
        const ref = shellArg(location.href);
        return `yt-dlp --referer ${ref} ${shellArg(url)}`;
    }

    function buildFfmpegCmd(url) {
        const ref = location.href.replace(/"/g, '');
        return `ffmpeg -headers "Referer: ${ref}\\r\\n" -i ${shellArg(url)} -c copy output.mp4`;
    }

    function matchesFilter(item, query) {
        if (!query) return true;
        const q = query.toLowerCase().trim();
        if (!q) return true;
        const words = q.split(/\s+/).filter(Boolean);
        return words.every(w => {
            if (item.url && item.url.toLowerCase().includes(w)) return true;
            if (item.type && item.type.toLowerCase().includes(w)) return true;
            if (item.source && item.source.toLowerCase().includes(w)) return true;
            if (item.resolution && item.resolution.toLowerCase().includes(w)) return true;
            if (item.duration && item.duration.toLowerCase().includes(w)) return true;
            if (item.folder && item.folder.toLowerCase().includes(w)) return true;
            if (item.qualities && item.qualities.some(ql =>
                (ql.resolution && ql.resolution.toLowerCase().includes(w)) ||
                (ql.url && ql.url.toLowerCase().includes(w))
            )) return true;

            const cat = catKey(item.type);
            if (cat.toLowerCase().includes(w)) return true;
            if ((w === 'rec' || w === 'запись') && item.canRecord) return true;
            if ((w === 'стрим' || w === 'хлс') && cat === 'STREAM') return true;
            if ((w === 'видео' || w === 'мп4') && (cat === 'DIRECT' || cat === 'STREAM' || cat === 'BLOB')) return true;
            if ((w === 'аудио' || w === 'звук' || w === 'музыка') && cat === 'AUDIO') return true;
            if ((w === 'плеер' || w === 'вставка') && cat === 'EMBED') return true;
            if ((w === 'сегмент' || w === 'сегменты' || w === 'куски') && cat === 'CHUNKS') return true;
            return false;
        });
    }

    function renderItems() {
        if (!shadow) return;
        const container = shadow.getElementById('vh-content');
        const totalBadge = shadow.getElementById('vh-total');
        if (!container) return;

        const by = {};
        let matchedCount = 0;

        found.forEach(item => {
            // Актуализируем статус записи для локальных <video> перед отрисовкой
            if (item.videoEl) syncRecordableState(item);
            if (!matchesFilter(item, searchQuery)) return;
            matchedCount++;
            const k = catKey(item.type);
            (by[k] = by[k] || []).push(item);
        });

        if (totalBadge) {
            totalBadge.textContent = searchQuery ? `${matchedCount}/${found.size}` : found.size;
        }

        if (!found.size) {
            setSafeHTML(container, '<div class="vh-empty">Scanning current page... Play a video to intercept media streams.</div>');
            return;
        }

        if (searchQuery && matchedCount === 0) {
            setSafeHTML(container, `<div class="vh-empty">No media matching "${escapeHtml(searchQuery)}"<br><button class="vh-action-btn" id="vh-reset-filter" style="margin-top:8px;padding:3px 8px;font-size:11px;">Reset filter</button></div>`);
            const resetBtn = container.querySelector('#vh-reset-filter');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    const fi = shadow.getElementById('vh-filter-input');
                    if (fi) fi.value = '';
                    searchQuery = '';
                    renderItems();
                });
            }
            return;
        }

        let html = '';
        CATS.forEach(([key, label, color]) => {
            const list = by[key];
            if (!list || !list.length) return;

            html += `
                <div class="vh-group">
                    <div class="vh-group-head" style="color: ${color}">
                        <span>${key} — ${label} (${list.length})</span>
                    </div>
                    <div class="vh-list">
            `;

            list.forEach(item => {
                const safeUrl = escapeHtml(item.url);
                const metaParts = [];
                if (item.resolution) metaParts.push(escapeHtml(item.resolution));
                if (item.duration) metaParts.push(escapeHtml(item.duration));
                if (item.size) metaParts.push(escapeHtml(item.size));
                if (item.source) metaParts.push(escapeHtml(item.source));
                if (item.count > 1) metaParts.push(`×${item.count}`);

                let qualitiesHtml = '';
                if (item.qualities && item.qualities.length) {
                    qualitiesHtml = `<div class="vh-qualities">` +
                        item.qualities.map(q => {
                            const qRes = escapeHtml(q.resolution);
                            if (q.url) {
                                return `<button class="vh-pill vh-pill-dl" type="button" data-url="${escapeHtml(q.url)}" title="Download ${qRes} stream">⬇ ${qRes}</button>`;
                            }
                            return `<span class="vh-pill">${qRes}</span>`;
                        }).join('') +
                        `</div>`;
                }

                const isStream = item.type.startsWith('STREAM');
                const isDirect = item.type.startsWith('DIRECT');
                const isBlob = item.type.startsWith('BLOB');

                let actionButtons = `
                    <button class="vh-action-btn vh-btn-copy" type="button" data-url="${safeUrl}" title="Copy URL">📋</button>
                `;

                if (!isBlob) {
                    actionButtons += `
                        <button class="vh-action-btn vh-btn-ytdl" type="button" data-url="${safeUrl}" title="Copy yt-dlp command with Referer">yt-dlp</button>
                        <button class="vh-action-btn vh-btn-ff" type="button" data-url="${safeUrl}" title="Copy ffmpeg command with Referer">ffmpeg</button>
                    `;
                }

                if (isStream && item.url.includes('.m3u8')) {
                    actionButtons += `<button class="vh-action-btn vh-btn-dl-hls" type="button" data-url="${safeUrl}" title="Download HLS stream">⬇ Download</button>`;
                } else if (isDirect) {
                    actionButtons += `<a class="vh-action-btn" href="${safeUrl}" download="${escapeHtml(getSafePageTitle())}_${item.id}.mp4" target="_blank" rel="noopener noreferrer" title="Download direct file">⬇ Download</a>`;
                }

                // Кнопка REC отображается ТОЛЬКО если видео реально доступно для захвата MediaRecorder
                if (item.canRecord) {
                    const isRecThis = activeRecordItemId === item.id;
                    actionButtons += `<button class="vh-action-btn vh-btn-rec" type="button" data-id="${item.id}" title="Record live video stream">${isRecThis ? '⏹ Stop' : '⏺ Rec'}</button>`;
                }

                html += `
                    <div class="vh-card">
                        <div class="vh-link-row">
                            <a class="vh-url" href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${safeUrl}">${safeUrl}</a>
                            <div class="vh-actions">${actionButtons}</div>
                        </div>
                        ${metaParts.length ? `<div class="vh-sub">${metaParts.join(' • ')}</div>` : ''}
                        ${qualitiesHtml}
                    </div>
                `;
            });

            html += '</div></div>';
        });

        setSafeHTML(container, html);

        container.querySelectorAll('.vh-btn-copy').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetUrl = e.currentTarget.getAttribute('data-url');
                if (targetUrl) {
                    navigator.clipboard.writeText(targetUrl);
                    const b = e.currentTarget;
                    b.textContent = '✓';
                    setTimeout(() => { b.textContent = '📋'; }, 1200);
                }
            });
        });

        container.querySelectorAll('.vh-btn-ytdl').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetUrl = e.currentTarget.getAttribute('data-url');
                if (targetUrl) {
                    navigator.clipboard.writeText(buildYtDlpCmd(targetUrl));
                    const b = e.currentTarget;
                    b.textContent = '✓';
                    setTimeout(() => { b.textContent = 'yt-dlp'; }, 1200);
                }
            });
        });

        container.querySelectorAll('.vh-btn-ff').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetUrl = e.currentTarget.getAttribute('data-url');
                if (targetUrl) {
                    navigator.clipboard.writeText(buildFfmpegCmd(targetUrl));
                    const b = e.currentTarget;
                    b.textContent = '✓';
                    setTimeout(() => { b.textContent = 'ffmpeg'; }, 1200);
                }
            });
        });

        container.querySelectorAll('.vh-btn-dl-hls, .vh-pill-dl').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetUrl = e.currentTarget.getAttribute('data-url');
                if (targetUrl) downloadHlsStream(targetUrl, e.currentTarget);
            });
        });

        container.querySelectorAll('.vh-btn-rec').forEach(btn => {
            const itemId = Number(btn.getAttribute('data-id'));
            if (activeRecordItemId === itemId) {
                activeRecordBtn = btn;
            }
            btn.addEventListener('click', e => {
                const item = [...found.values()].find(x => x.id === itemId);
                if (item) handleRecClick(item, e.currentTarget);
            });
        });
    }

    function startFreshScanSession() {
        resetSessionData();
        scanningActive = true;
        broadcastToFrames(window, { type: 'VH_SET_SCANNING', active: true });
        scanAll(true);
        renderItems();
    }

    function showModal() {
        if (!hostEl) {
            createFloatingWindow();
        } else {
            const parent = getHostParent();
            if (!parent.contains(hostEl)) parent.appendChild(hostEl);
            hostEl.style.display = 'block';
        }
        const fi = shadow && shadow.getElementById('vh-filter-input');
        if (fi) fi.value = '';
        searchQuery = '';
        startFreshScanSession();
    }

    function hideModal() {
        // Останавливаем активную запись при закрытии окна, если она шла
        if (activeRecordItemId !== null) {
            if (activeRecordFrameId === FRAME_ID) {
                stopLocalRecording(false);
            } else {
                broadcastToFrames(window, { type: 'VH_CMD_STOP_REC', frameId: activeRecordFrameId });
                resetRecordButtonUI(false);
            }
        }

        scanningActive = false;
        broadcastToFrames(window, { type: 'VH_SET_SCANNING', active: false });
        resetSessionData();
        clearPerformanceHistory();

        if (shadow) {
            const container = shadow.getElementById('vh-content');
            if (container) setSafeHTML(container, '');
            const totalBadge = shadow.getElementById('vh-total');
            if (totalBadge) totalBadge.textContent = '0';
        }

        if (hostEl) hostEl.style.display = 'none';
    }

    function toggleModal() {
        if (isModalOpen()) hideModal();
        else showModal();
    }

    // Привязываем перехватчики на старте, но scanningActive = false пока меню закрыто
    attachDoc(document, '');

    // Очистка буфера ресурсов браузера при SPA-переходах, чтобы старые видео не попадали в новый скан
    ['popstate', 'yt-navigate-start', 'yt-navigate-finish'].forEach(ev => {
        window.addEventListener(ev, () => {
            if (!isModalOpen()) {
                clearPerformanceHistory();
            }
        });
    });

    window.addEventListener('keydown', e => {
        const path = e.composedPath ? e.composedPath() : [];
        const isEditing = path.some(el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) ||
                          ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;

        if (checkHotkeys(e)) {
            toggleModal();
            return;
        }

        if (e.key === 'Escape' && isModalOpen() && !isEditing) {
            hideModal();
        }
    }, true);

    document.addEventListener('fullscreenchange', () => {
        if (hostEl && isModalOpen()) {
            getHostParent().appendChild(hostEl);
        }
    });
})();

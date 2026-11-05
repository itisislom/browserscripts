// ==UserScript==
// @name         Cookie By Islom
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Advanced floating Cookie Manager & Editor: view, search, create, edit, delete, import, and export all site cookies including HttpOnly (Alt + C)
// @author       Islom Sadriddinov
// @match        *://*/*
// @grant        GM_cookie
// @grant        GM.cookie
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const HOST_ID = 'islom-cookie-editor-host';
    const API_TIMEOUT = 5000;
    const HELP_PATH = 'Tampermonkey Dashboard → Settings → Config mode: Advanced → Security → "Allow scripts to access cookies" → All';

    // ───────────────────────── Styles (Shadow DOM Isolated) ─────────────────────────
    const STYLES = `
        :host {
            all: initial;
            position: fixed;
            z-index: 2147483647;
            top: 0;
            left: 0;
            width: 0;
            height: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
        }
        * {
            box-sizing: border-box;
        }
        .modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 760px;
            max-width: 95vw;
            height: 600px;
            max-height: 85vh;
            background: rgba(24, 24, 28, 0.96);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            color: #f4f4f6;
            border-radius: 14px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-size: 13px;
            line-height: 1.4;
        }
        .header {
            padding: 12px 16px;
            background: rgba(16, 16, 20, 0.9);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
            gap: 10px;
        }
        .title-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
        }
        .title {
            font-weight: 600;
            font-size: 14px;
            color: #ffffff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .status-pill {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 999px;
            font-weight: 600;
            white-space: nowrap;
        }
        .status-ok {
            background: rgba(46, 125, 50, 0.25);
            color: #81c784;
            border: 1px solid rgba(129, 199, 132, 0.3);
        }
        .status-fallback {
            background: rgba(230, 81, 0, 0.25);
            color: #ffb74d;
            border: 1px solid rgba(255, 183, 77, 0.35);
            cursor: pointer;
        }
        .header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .icon-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #d4d4d8;
            border-radius: 6px;
            padding: 5px 8px;
            font-size: 12px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .icon-btn:hover {
            background: rgba(255, 255, 255, 0.14);
            color: #ffffff;
        }
        .icon-btn.danger:hover {
            background: rgba(211, 47, 47, 0.28);
            border-color: rgba(244, 67, 54, 0.5);
            color: #ff8a80;
        }
        .icon-btn.primary {
            background: #2563eb;
            border-color: #3b82f6;
            color: #ffffff;
            font-weight: 600;
        }
        .icon-btn.primary:hover {
            background: #1d4ed8;
        }
        .toolbar {
            padding: 10px 16px;
            background: rgba(20, 20, 24, 0.75);
            border-bottom: 1px solid rgba(255, 255, 255, 0.07);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }
        .search-input {
            flex: 1;
            min-width: 180px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 7px;
            padding: 6px 10px;
            color: #fff;
            font-size: 12px;
            outline: none;
        }
        .search-input:focus {
            border-color: #3b82f6;
        }
        .filter-group {
            display: flex;
            gap: 4px;
        }
        .chip {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #a1a1aa;
            padding: 4px 9px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
        }
        .chip.active {
            background: rgba(59, 130, 246, 0.22);
            border-color: #3b82f6;
            color: #93c5fd;
        }
        .banner {
            margin: 8px 16px 0;
            padding: 8px 12px;
            border-radius: 8px;
            background: rgba(245, 158, 11, 0.12);
            border: 1px solid rgba(245, 158, 11, 0.35);
            color: #fde68a;
            font-size: 11.5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
        }
        .list {
            padding: 12px 16px;
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .row {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: border-color 0.15s;
        }
        .row:hover {
            border-color: rgba(255, 255, 255, 0.18);
        }
        .row-main {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .info {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            font-size: 13px;
        }
        .c-name {
            font-weight: 600;
            color: #ffffff;
        }
        .c-val {
            color: #a1a1aa;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 12px;
        }
        .c-meta {
            font-size: 11px;
            color: #71717a;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        .decoded-box {
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 6px;
            padding: 6px 8px;
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 11px;
            color: #93c5fd;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 110px;
            overflow-y: auto;
        }
        .actions {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
        }
        .badge {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            white-space: nowrap;
        }
        .b-httponly { background: rgba(217, 119, 6, 0.22); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.3); }
        .b-secure   { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); }
        .b-session  { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.3); }
        .drawer {
            padding: 12px 16px;
            background: rgba(14, 14, 18, 0.95);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
        }
        .field {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .field label {
            font-size: 10.5px;
            color: #a1a1aa;
            font-weight: 600;
        }
        .field input, .field select, .field textarea {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 6px;
            padding: 5px 8px;
            color: #ffffff;
            font-size: 12px;
            outline: none;
            font-family: inherit;
        }
        .field textarea {
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            resize: vertical;
            min-height: 48px;
        }
        .checkbox-row {
            display: flex;
            gap: 14px;
            align-items: center;
            padding-top: 4px;
        }
        .checkbox-row label {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            color: #d4d4d8;
            cursor: pointer;
        }
        .footer {
            padding: 10px 16px;
            background: rgba(16, 16, 20, 0.9);
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }
        .footer-btns {
            display: flex;
            gap: 6px;
            width: 100%;
            flex-wrap: wrap;
        }
        .f-btn {
            flex: 1;
            min-width: 110px;
            padding: 8px 8px;
            background: rgba(255, 255, 255, 0.07);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            font-weight: 600;
            font-size: 11.5px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .f-btn:hover {
            background: rgba(255, 255, 255, 0.14);
        }
        .author {
            font-size: 11px;
            color: #71717a;
        }
        .empty {
            color: #71717a;
            text-align: center;
            padding: 36px 10px;
            font-size: 13px;
        }
    `;

    // ───────────────────────── SVG Icons (TrustedHTML Safe) ─────────────────────────
    function createEyeIcon(isOpen) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');

        if (isOpen) {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('d', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z');
            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', '12');
            circle.setAttribute('cy', '12');
            circle.setAttribute('r', '3');
            svg.append(path, circle);
        } else {
            const p1 = document.createElementNS(svgNS, 'path');
            p1.setAttribute('d', 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94');
            const p2 = document.createElementNS(svgNS, 'path');
            p2.setAttribute('d', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19');
            const p3 = document.createElementNS(svgNS, 'path');
            p3.setAttribute('d', 'M14.12 14.12a3 3 0 1 1-4.24-4.24');
            const line = document.createElementNS(svgNS, 'line');
            line.setAttribute('x1', '1');
            line.setAttribute('y1', '1');
            line.setAttribute('x2', '23');
            line.setAttribute('y2', '23');
            svg.append(p1, p2, p3, line);
        }
        return svg;
    }

    // ───────────────────────── Multi-Engine Cookie API (GM + CookieStore + DOM) ─────────────────────────
    function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
            promise.then(
                (val) => { clearTimeout(timer); resolve(val); },
                (err) => { clearTimeout(timer); reject(err); }
            );
        });
    }

    function gmCall(method, details) {
        // Try callback-based GM_cookie first
        const viaCallback = () => new Promise((resolve, reject) => {
            if (typeof GM_cookie === 'undefined' || typeof GM_cookie[method] !== 'function') {
                return reject(new Error(`GM_cookie.${method} unavailable`));
            }
            try {
                GM_cookie[method](details, (res, err) => {
                    if (err) reject(new Error(String(err)));
                    else resolve(res);
                });
            } catch (e) {
                reject(e);
            }
        });

        // Fallback to Promise-based GM.cookie
        const viaPromise = () => {
            if (typeof GM === 'undefined' || !GM.cookie || typeof GM.cookie[method] !== 'function') {
                return Promise.reject(new Error(`GM.cookie.${method} unavailable`));
            }
            return Promise.resolve(GM.cookie[method](details));
        };

        return withTimeout(viaCallback(), API_TIMEOUT, `GM_cookie.${method}`)
            .catch(() => withTimeout(viaPromise(), API_TIMEOUT, `GM.cookie.${method}`));
    }

    async function listCookies(details, diag) {
        try {
            const res = await gmCall('list', details);
            diag.ok = true;
            return Array.isArray(res) ? res : [];
        } catch (err) {
            diag.errors.push(err.message || String(err));
            return [];
        }
    }

    // Write cookie via GM_cookie with automatic fallback to CookieStore / document.cookie
    async function saveCookie(cookieData) {
        const details = {
            url: window.location.origin + (cookieData.path || '/'),
            name: cookieData.name,
            value: cookieData.value ?? '',
            domain: cookieData.domain || window.location.hostname,
            path: cookieData.path || '/',
            secure: Boolean(cookieData.secure),
            httpOnly: Boolean(cookieData.httpOnly),
            sameSite: cookieData.sameSite || 'lax'
        };
        if (cookieData.expirationDate) {
            details.expirationDate = Number(cookieData.expirationDate);
        }

        try {
            await gmCall('set', details);
            return { ok: true, engine: 'GM_cookie' };
        } catch (_) {
            // Fallback to standard client-side cookie setting (works without Tampermonkey settings for non-HttpOnly)
            try {
                let parts = [`${encodeURIComponent(details.name)}=${encodeURIComponent(details.value)}`];
                if (details.path) parts.push(`path=${details.path}`);
                if (details.domain && details.domain !== window.location.hostname) {
                    parts.push(`domain=${details.domain}`);
                }
                if (details.expirationDate) {
                    parts.push(`expires=${new Date(details.expirationDate * 1000).toUTCString()}`);
                }
                if (details.secure) parts.push('secure');
                if (details.sameSite) parts.push(`samesite=${details.sameSite}`);
                document.cookie = parts.join('; ');
                return { ok: true, engine: 'document.cookie' };
            } catch (err) {
                return { ok: false, error: err.message };
            }
        }
    }

    // Delete cookie via GM_cookie with fallback to CookieStore and document.cookie
    async function removeCookie(cookie) {
        const targetUrl = `${window.location.protocol}//${(cookie.domain || window.location.hostname).replace(/^\./, '')}${cookie.path || '/'}`;
        try {
            await gmCall('delete', { url: targetUrl, name: cookie.name });
        } catch (_) {
            // Ignore and run client-side fallbacks
        }

        if (window.cookieStore && typeof window.cookieStore.delete === 'function') {
            try {
                await window.cookieStore.delete({ name: cookie.name, path: cookie.path || '/' });
            } catch (_) { /* ignore */ }
        }

        // Expire across common domain/path permutations in document.cookie
        const host = window.location.hostname;
        const domains = [undefined, host, `.${host}`, cookie.domain, cookie.domain ? `.${cookie.domain.replace(/^\./, '')}` : undefined];
        const paths = [cookie.path || '/', '/'];
        domains.forEach((d) => {
            paths.forEach((p) => {
                const domPart = d ? `; domain=${d}` : '';
                document.cookie = `${cookie.name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}${domPart}`;
            });
        });
    }

    function guessBaseDomain(host) {
        if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)) return host;
        const parts = host.split('.');
        const secondLevel = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);
        const last = parts[parts.length - 1];
        const prev = parts[parts.length - 2];
        if (parts.length >= 3 && last.length === 2 && secondLevel.has(prev)) {
            return parts.slice(-3).join('.');
        }
        return parts.slice(-2).join('.');
    }

    // ───────────────────────── Collect All Page Cookies ─────────────────────────
    async function getAllPageCookies(diag) {
        const host = window.location.hostname;
        const base = guessBaseDomain(host);
        const map = new Map();

        const add = (c, src) => {
            if (!c || !c.name) return;
            const domain = c.domain || host;
            const path = c.path || '/';
            const part = c.partitionKey ? JSON.stringify(c.partitionKey) : '';
            const key = `${c.name}@@${domain}@@${path}@@${part}`;
            if (!map.has(key)) {
                map.set(key, Object.assign({}, c, {
                    value: c.value ?? '',
                    domain,
                    path,
                    httpOnly: Boolean(c.httpOnly),
                    secure: Boolean(c.secure),
                    session: Boolean(c.session || !c.expirationDate),
                    _src: src
                }));
            }
        };

        const inScope = (c) => {
            const d = String(c.domain || '').replace(/^\./, '').toLowerCase();
            return d === base || d.endsWith('.' + base);
        };

        // 1. Query GM_cookie (HttpOnly + parent domains + CHIPS partitioned cookies)
        const queries = [
            { details: { url: window.location.href }, scoped: false },
            { details: { domain: host }, scoped: true },
            { details: { domain: base }, scoped: true },
            { details: { url: window.location.href, partitionKey: {} }, scoped: false }
        ];
        const results = await Promise.all(queries.map((q) => listCookies(q.details, diag)));
        results.forEach((list, i) => {
            list.forEach((c) => {
                if (!queries[i].scoped || inScope(c)) add(c, 'gm');
            });
        });

        // 2. Fallback: CookieStore API
        const gmNames = new Set(Array.from(map.values()).map((c) => c.name));
        if (window.cookieStore && typeof window.cookieStore.getAll === 'function') {
            try {
                const storeCookies = await window.cookieStore.getAll();
                storeCookies.forEach((c) => {
                    if (gmNames.has(c.name)) return;
                    add({
                        name: c.name,
                        value: c.value,
                        domain: c.domain || host,
                        path: c.path || '/',
                        secure: c.secure,
                        sameSite: c.sameSite,
                        expirationDate: c.expires ? c.expires / 1000 : undefined
                    }, 'cookieStore');
                });
            } catch (_) { /* ignore */ }
        }

        // 3. Fallback: document.cookie
        try {
            const raw = document.cookie;
            if (raw && raw.trim()) {
                const knownNames = new Set(Array.from(map.values()).map((c) => c.name));
                raw.split(';').forEach((pair) => {
                    const idx = pair.indexOf('=');
                    const name = idx > -1 ? pair.slice(0, idx).trim() : pair.trim();
                    const value = idx > -1 ? pair.slice(idx + 1).trim() : '';
                    if (name && !knownNames.has(name)) {
                        add({ name, value, secure: window.location.protocol === 'https:' }, 'document.cookie');
                    }
                });
            }
        } catch (_) { /* ignore */ }

        return Array.from(map.values()).sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
    }

    // ───────────────────────── Formatters, Decoders & Export ─────────────────────────
    function stripInternal(cookies) {
        return cookies.map((c) => {
            const copy = Object.assign({}, c);
            delete copy._src;
            return copy;
        });
    }

    function toNetscape(cookies) {
        const lines = ['# Netscape HTTP Cookie File', '# Generated by Cookie By Islom v5.0', ''];
        cookies.forEach((c) => {
            let domain = String(c.domain || window.location.hostname);
            const hostOnly = c.hostOnly === true || (c.hostOnly === undefined && !domain.startsWith('.'));
            if (!hostOnly && !domain.startsWith('.')) domain = '.' + domain;
            const expires = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate);
            lines.push([
                (c.httpOnly ? '#HttpOnly_' : '') + domain,
                hostOnly ? 'FALSE' : 'TRUE',
                c.path || '/',
                c.secure ? 'TRUE' : 'FALSE',
                expires,
                c.name,
                c.value
            ].join('\t'));
        });
        return lines.join('\n') + '\n';
    }

    function toHeaderString(cookies) {
        return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }

    // Smart decoder for URL-encoded strings, JSON, or JWT tokens
    function tryDecodeValue(val) {
        if (!val || val.length < 3) return null;
        // Check JWT
        const jwtParts = val.split('.');
        if (jwtParts.length === 3 && val.startsWith('eyJ')) {
            try {
                const payload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
                return `JWT Payload:\n${JSON.stringify(payload, null, 2)}`;
            } catch (_) { /* ignore */ }
        }
        // Check URL-encoded or JSON
        try {
            const decoded = decodeURIComponent(val);
            if (decoded !== val) {
                try {
                    const parsed = JSON.parse(decoded);
                    return `Decoded JSON:\n${JSON.stringify(parsed, null, 2)}`;
                } catch (_) {
                    return `URL Decoded:\n${decoded}`;
                }
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    function parseImportInput(rawText) {
        const text = rawText.trim();
        if (!text) return [];

        // 1. JSON format
        if (text.startsWith('[') || text.startsWith('{')) {
            const parsed = JSON.parse(text);
            return Array.isArray(parsed) ? parsed : [parsed];
        }

        // 2. Netscape cookies.txt format
        if (text.includes('\t')) {
            const list = [];
            text.split(/\r?\n/).forEach((line) => {
                const trimmed = line.trim();
                if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_'))) return;
                const httpOnly = trimmed.startsWith('#HttpOnly_');
                const clean = httpOnly ? trimmed.replace(/^#HttpOnly_/, '') : trimmed;
                const parts = clean.split('\t');
                if (parts.length >= 7) {
                    list.push({
                        domain: parts[0],
                        path: parts[2] || '/',
                        secure: parts[3].toUpperCase() === 'TRUE',
                        expirationDate: Number(parts[4]) > 0 ? Number(parts[4]) : undefined,
                        name: parts[5],
                        value: parts[6],
                        httpOnly
                    });
                }
            });
            return list;
        }

        // 3. Raw Cookie header (name=val; name2=val2)
        const rawHeader = text.replace(/^Cookie:\s*/i, '');
        return rawHeader.split(';').map((pair) => {
            const idx = pair.indexOf('=');
            if (idx === -1) return null;
            return {
                name: pair.slice(0, idx).trim(),
                value: pair.slice(idx + 1).trim(),
                domain: window.location.hostname,
                path: '/'
            };
        }).filter(Boolean);
    }

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: `${mime};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { /* fallback */ }
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text, 'text');
                return true;
            }
        } catch (_) { /* ignore */ }
        return false;
    }

    function flash(btn, text, bgColor) {
        const oldText = btn.textContent;
        const oldBg = btn.style.background;
        btn.textContent = text;
        btn.style.background = bgColor;
        setTimeout(() => {
            btn.textContent = oldText;
            btn.style.background = oldBg;
        }, 1100);
    }

    // ───────────────────────── UI & Modal Controller ─────────────────────────
    function closeMenu() {
        const existing = document.getElementById(HOST_ID);
        if (existing) existing.remove();
    }

    function makeDraggable(modal, handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            const rect = modal.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            modal.style.transform = 'none';
            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;

            const onMove = (ev) => {
                const newLeft = Math.min(Math.max(0, ev.clientX - offsetX), window.innerWidth - 100);
                const newTop = Math.min(Math.max(0, ev.clientY - offsetY), window.innerHeight - 48);
                modal.style.left = `${newLeft}px`;
                modal.style.top = `${newTop}px`;
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
    }

    function openMenu() {
        closeMenu();

        let cookies = [];
        let searchQuery = '';
        let activeFilter = 'all'; // all | httponly | secure | session
        let revealAll = false;
        let diag = { ok: false, errors: [] };

        // Create Shadow DOM Host
        const host = document.createElement('div');
        host.id = HOST_ID;
        const shadow = host.attachShadow({ mode: 'open' });

        const styleTag = document.createElement('style');
        styleTag.textContent = STYLES;
        shadow.appendChild(styleTag);

        const modal = document.createElement('div');
        modal.className = 'modal';

        // 1. Header
        const header = document.createElement('div');
        header.className = 'header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'title-wrap';

        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = `Cookie By Islom — ${window.location.hostname}`;

        const statusPill = document.createElement('span');
        statusPill.className = 'status-pill status-ok';
        statusPill.textContent = 'Loading…';

        titleWrap.append(title, statusPill);

        const headerActions = document.createElement('div');
        headerActions.className = 'header-actions';

        const newCookieBtn = document.createElement('button');
        newCookieBtn.className = 'icon-btn primary';
        newCookieBtn.textContent = '+ New';
        newCookieBtn.title = 'Create a new cookie';

        const importBtn = document.createElement('button');
        importBtn.className = 'icon-btn';
        importBtn.textContent = 'Import';
        importBtn.title = 'Import JSON, Netscape cookies.txt, or Cookie header';

        const revealAllBtn = document.createElement('button');
        revealAllBtn.className = 'icon-btn';
        revealAllBtn.textContent = 'Show All';
        revealAllBtn.title = 'Reveal or mask all cookie values';

        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'icon-btn danger';
        clearAllBtn.textContent = 'Clear All';
        clearAllBtn.title = 'Delete all cookies for this site';

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'icon-btn';
        refreshBtn.textContent = '↻';
        refreshBtn.title = 'Refresh cookies';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'icon-btn';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close (Esc)';
        closeBtn.addEventListener('click', closeMenu);

        headerActions.append(newCookieBtn, importBtn, revealAllBtn, clearAllBtn, refreshBtn, closeBtn);
        header.append(titleWrap, headerActions);
        makeDraggable(modal, header);

        // 2. Search & Filter Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';

        const searchInput = document.createElement('input');
        searchInput.className = 'search-input';
        searchInput.placeholder = 'Search by cookie name, value, or domain…';
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim().toLowerCase();
            renderList();
        });

        const filterGroup = document.createElement('div');
        filterGroup.className = 'filter-group';
        const filters = [
            { id: 'all', label: 'All' },
            { id: 'httponly', label: 'HttpOnly' },
            { id: 'secure', label: 'Secure' },
            { id: 'session', label: 'Session' }
        ];
        const filterButtons = new Map();
        filters.forEach((f) => {
            const chip = document.createElement('button');
            chip.className = 'chip' + (f.id === activeFilter ? ' active' : '');
            chip.textContent = f.label;
            chip.addEventListener('click', () => {
                activeFilter = f.id;
                filterButtons.forEach((btn, key) => btn.classList.toggle('active', key === activeFilter));
                renderList();
            });
            filterButtons.set(f.id, chip);
            filterGroup.appendChild(chip);
        });

        toolbar.append(searchInput, filterGroup);

        // Optional diagnostic banner slot
        const bannerSlot = document.createElement('div');

        // 3. Cookie List Container
        const listContainer = document.createElement('div');
        listContainer.className = 'list';

        // 4. Drawer Slot (for Create/Edit Cookie or Import)
        const drawerSlot = document.createElement('div');

        // 5. Footer
        const footer = document.createElement('div');
        footer.className = 'footer';

        const footerBtns = document.createElement('div');
        footerBtns.className = 'footer-btns';

        const dlJsonBtn = document.createElement('button');
        dlJsonBtn.className = 'f-btn';
        dlJsonBtn.textContent = 'Download .JSON';
        dlJsonBtn.addEventListener('click', () => {
            downloadFile(`cookies_${window.location.hostname}.json`, JSON.stringify(stripInternal(cookies), null, 2), 'application/json');
        });

        const dlTxtBtn = document.createElement('button');
        dlTxtBtn.className = 'f-btn';
        dlTxtBtn.textContent = 'Download cookies.txt';
        dlTxtBtn.addEventListener('click', () => {
            downloadFile(`cookies_${window.location.hostname}.txt`, toNetscape(cookies), 'text/plain');
        });

        const copyJsonBtn = document.createElement('button');
        copyJsonBtn.className = 'f-btn';
        copyJsonBtn.textContent = 'Copy JSON';
        copyJsonBtn.addEventListener('click', async () => {
            const ok = await copyText(JSON.stringify(stripInternal(cookies), null, 2));
            flash(copyJsonBtn, ok ? 'Copied JSON!' : 'Error', ok ? '#15803d' : '#b91c1c');
        });

        const copyHeaderBtn = document.createElement('button');
        copyHeaderBtn.className = 'f-btn';
        copyHeaderBtn.textContent = 'Copy Header String';
        copyHeaderBtn.addEventListener('click', async () => {
            const ok = await copyText(toHeaderString(cookies));
            flash(copyHeaderBtn, ok ? 'Copied Header!' : 'Error', ok ? '#15803d' : '#b91c1c');
        });

        footerBtns.append(dlJsonBtn, dlTxtBtn, copyJsonBtn, copyHeaderBtn);

        const author = document.createElement('div');
        author.className = 'author';
        author.textContent = 'Cookie By Islom v5.0 • Made by Islom Sadriddinov';

        footer.append(footerBtns, author);

        modal.append(header, toolbar, bannerSlot, listContainer, drawerSlot, footer);
        shadow.appendChild(modal);
        (document.body || document.documentElement).appendChild(host);

        // ───────────────────────── Drawers (Editor & Importer) ─────────────────────────
        function closeDrawer() {
            drawerSlot.replaceChildren();
        }

        function openEditorDrawer(initialCookie) {
            drawerSlot.replaceChildren();
            const isEdit = Boolean(initialCookie);
            const c = initialCookie || {
                name: '',
                value: '',
                domain: window.location.hostname,
                path: '/',
                sameSite: 'Lax',
                secure: window.location.protocol === 'https:',
                httpOnly: false,
                expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30
            };

            const drawer = document.createElement('div');
            drawer.className = 'drawer';

            const grid = document.createElement('div');
            grid.className = 'form-grid';

            const makeField = (labelText, inputEl) => {
                const wrap = document.createElement('div');
                wrap.className = 'field';
                const lbl = document.createElement('label');
                lbl.textContent = labelText;
                wrap.append(lbl, inputEl);
                return wrap;
            };

            const nameInp = document.createElement('input');
            nameInp.value = c.name;
            nameInp.placeholder = 'session_id';

            const domainInp = document.createElement('input');
            domainInp.value = c.domain || window.location.hostname;

            const pathInp = document.createElement('input');
            pathInp.value = c.path || '/';

            grid.append(
                makeField('Name', nameInp),
                makeField('Domain', domainInp),
                makeField('Path', pathInp)
            );

            const valInp = document.createElement('textarea');
            valInp.value = c.value ?? '';
            valInp.placeholder = 'Cookie value…';

            const bottomRow = document.createElement('div');
            bottomRow.style.display = 'flex';
            bottomRow.style.justifyContent = 'space-between';
            bottomRow.style.alignItems = 'center';
            bottomRow.style.flexWrap = 'wrap';
            bottomRow.style.gap = '10px';

            const checks = document.createElement('div');
            checks.className = 'checkbox-row';

            const makeCheck = (label, checked) => {
                const lbl = document.createElement('label');
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = Boolean(checked);
                lbl.append(box, document.createTextNode(label));
                return { lbl, box };
            };

            const secureChk = makeCheck('Secure', c.secure);
            const httpOnlyChk = makeCheck('HttpOnly (requires GM_cookie)', c.httpOnly);
            checks.append(secureChk.lbl, httpOnlyChk.lbl);

            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '6px';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'icon-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', closeDrawer);

            const saveBtn = document.createElement('button');
            saveBtn.className = 'icon-btn primary';
            saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Cookie';
            saveBtn.addEventListener('click', async () => {
                const name = nameInp.value.trim();
                if (!name) return;
                if (isEdit && initialCookie.name !== name) {
                    await removeCookie(initialCookie);
                }
                await saveCookie({
                    name,
                    value: valInp.value,
                    domain: domainInp.value.trim() || window.location.hostname,
                    path: pathInp.value.trim() || '/',
                    secure: secureChk.box.checked,
                    httpOnly: httpOnlyChk.box.checked,
                    expirationDate: c.expirationDate
                });
                closeDrawer();
                await reloadCookies();
            });

            btnGroup.append(cancelBtn, saveBtn);
            bottomRow.append(checks, btnGroup);

            drawer.append(grid, makeField('Value', valInp), bottomRow);
            drawerSlot.appendChild(drawer);
            nameInp.focus();
        }

        function openImportDrawer() {
            drawerSlot.replaceChildren();
            const drawer = document.createElement('div');
            drawer.className = 'drawer';

            const field = document.createElement('div');
            field.className = 'field';
            const lbl = document.createElement('label');
            lbl.textContent = 'Paste JSON array, Netscape cookies.txt, or raw Cookie header (key=val; key2=val2)';
            const area = document.createElement('textarea');
            area.placeholder = '[{"name": "token", "value": "123"}] or name=value; other=value';
            area.style.minHeight = '76px';
            field.append(lbl, area);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '6px';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'icon-btn';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', closeDrawer);

            const applyBtn = document.createElement('button');
            applyBtn.className = 'icon-btn primary';
            applyBtn.textContent = 'Import Cookies';
            applyBtn.addEventListener('click', async () => {
                try {
                    const parsed = parseImportInput(area.value);
                    for (const item of parsed) {
                        if (item && item.name) await saveCookie(item);
                    }
                    closeDrawer();
                    await reloadCookies();
                } catch (e) {
                    flash(applyBtn, 'Invalid Format', '#b91c1c');
                }
            });

            btnRow.append(cancelBtn, applyBtn);
            drawer.append(field, btnRow);
            drawerSlot.appendChild(drawer);
            area.focus();
        }

        // ───────────────────────── Header Button Bindings ─────────────────────────
        newCookieBtn.addEventListener('click', () => openEditorDrawer(null));
        importBtn.addEventListener('click', openImportDrawer);

        revealAllBtn.addEventListener('click', () => {
            revealAll = !revealAll;
            revealAllBtn.textContent = revealAll ? 'Mask All' : 'Show All';
            renderList();
        });

        clearAllBtn.addEventListener('click', async () => {
            if (!cookies.length) return;
            for (const c of cookies) {
                await removeCookie(c);
            }
            await reloadCookies();
        });

        refreshBtn.addEventListener('click', reloadCookies);

        // ───────────────────────── Render List ─────────────────────────
        function showHelpBanner() {
            bannerSlot.replaceChildren();
            const b = document.createElement('div');
            b.className = 'banner';
            const txt = document.createElement('span');
            txt.textContent = `Standard cookies work automatically. To unlock HttpOnly cookies, enable: ${HELP_PATH}`;
            const copyPathBtn = document.createElement('button');
            copyPathBtn.className = 'icon-btn';
            copyPathBtn.textContent = 'Copy Guide';
            copyPathBtn.addEventListener('click', async () => {
                await copyText(HELP_PATH);
                flash(copyPathBtn, 'Copied!', '#15803d');
            });
            b.append(txt, copyPathBtn);
            bannerSlot.appendChild(b);
        }

        function renderList() {
            const httpOnlyCount = cookies.filter((c) => c.httpOnly).length;
            title.textContent = `Cookie By Islom — ${window.location.hostname} (${cookies.length})`;

            if (diag.ok) {
                statusPill.className = 'status-pill status-ok';
                statusPill.textContent = `HttpOnly: ${httpOnlyCount}`;
                statusPill.title = 'Full GM_cookie engine active';
            } else {
                statusPill.className = 'status-pill status-fallback';
                statusPill.textContent = 'Standard Mode (Click for HttpOnly)';
                statusPill.title = 'Click to see how to enable HttpOnly access in Tampermonkey';
                statusPill.onclick = showHelpBanner;
            }

            listContainer.replaceChildren();

            const filtered = cookies.filter((c) => {
                if (activeFilter === 'httponly' && !c.httpOnly) return false;
                if (activeFilter === 'secure' && !c.secure) return false;
                if (activeFilter === 'session' && !c.session) return false;
                if (searchQuery) {
                    const hay = `${c.name} ${c.value} ${c.domain}`.toLowerCase();
                    if (!hay.includes(searchQuery)) return false;
                }
                return true;
            });

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = cookies.length === 0
                    ? 'No cookies found for this site.'
                    : 'No cookies match your current search or filter.';
                listContainer.appendChild(empty);
                return;
            }

            filtered.forEach((cookie) => {
                let isHidden = !revealAll;
                const maskedValue = '•'.repeat(Math.min(Math.max((cookie.value || '').length, 8), 24));

                const row = document.createElement('div');
                row.className = 'row';

                const main = document.createElement('div');
                main.className = 'row-main';

                const info = document.createElement('div');
                info.className = 'info';
                info.title = `${cookie.domain}${cookie.path}`;

                const nameSpan = document.createElement('span');
                nameSpan.className = 'c-name';
                nameSpan.textContent = `${cookie.name}: `;

                const valSpan = document.createElement('span');
                valSpan.className = 'c-val';
                valSpan.textContent = isHidden ? maskedValue : cookie.value;

                info.append(nameSpan, valSpan);

                const actions = document.createElement('div');
                actions.className = 'actions';

                if (cookie.httpOnly) {
                    const b = document.createElement('span');
                    b.className = 'badge b-httponly';
                    b.textContent = 'HttpOnly';
                    actions.appendChild(b);
                }
                if (cookie.secure) {
                    const b = document.createElement('span');
                    b.className = 'badge b-secure';
                    b.textContent = 'Secure';
                    actions.appendChild(b);
                }
                if (cookie.session) {
                    const b = document.createElement('span');
                    b.className = 'badge b-session';
                    b.textContent = 'Session';
                    actions.appendChild(b);
                }

                const decodedSlot = document.createElement('div');

                const updateDecodedPreview = () => {
                    decodedSlot.replaceChildren();
                    if (!isHidden) {
                        const decoded = tryDecodeValue(cookie.value);
                        if (decoded) {
                            const box = document.createElement('div');
                            box.className = 'decoded-box';
                            box.textContent = decoded;
                            decodedSlot.appendChild(box);
                        }
                    }
                };
                updateDecodedPreview();

                // Show / Hide value button
                const eyeBtn = document.createElement('button');
                eyeBtn.className = 'icon-btn';
                eyeBtn.title = 'Toggle value visibility & decode preview';
                eyeBtn.appendChild(createEyeIcon(!isHidden));
                eyeBtn.addEventListener('click', () => {
                    isHidden = !isHidden;
                    eyeBtn.replaceChildren(createEyeIcon(!isHidden));
                    valSpan.textContent = isHidden ? maskedValue : cookie.value;
                    updateDecodedPreview();
                });

                // Edit button
                const editBtn = document.createElement('button');
                editBtn.className = 'icon-btn';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => openEditorDrawer(cookie));

                // Copy button
                const copyBtn = document.createElement('button');
                copyBtn.className = 'icon-btn';
                copyBtn.textContent = 'Copy';
                copyBtn.title = 'Copy name=value (Shift+Click to copy value only)';
                copyBtn.addEventListener('click', async (ev) => {
                    const textToCopy = ev.shiftKey ? cookie.value : `${cookie.name}=${cookie.value}`;
                    const ok = await copyText(textToCopy);
                    flash(copyBtn, ok ? 'Copied!' : 'Error', ok ? '#15803d' : '#b91c1c');
                });

                // Delete button
                const delBtn = document.createElement('button');
                delBtn.className = 'icon-btn danger';
                delBtn.textContent = '✕';
                delBtn.title = 'Delete this cookie';
                delBtn.addEventListener('click', async () => {
                    await removeCookie(cookie);
                    await reloadCookies();
                });

                actions.append(eyeBtn, editBtn, copyBtn, delBtn);
                main.append(info, actions);
                row.append(main, decodedSlot);
                listContainer.appendChild(row);
            });
        }

        async function reloadCookies() {
            diag = { ok: false, errors: [] };
            try {
                cookies = await getAllPageCookies(diag);
            } catch (e) {
                diag.errors.push(String(e && e.message ? e.message : e));
            }
            if (host.isConnected) renderList();
        }

        reloadCookies();
    }

    function toggleMenu() {
        if (document.getElementById(HOST_ID)) {
            closeMenu();
        } else {
            openMenu();
        }
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Open / Close Cookie Editor (Alt + C)', toggleMenu);
    }

    // Hotkey: Alt + C (layout-independent via e.code) & Esc to close
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById(HOST_ID)) {
            closeMenu();
            return;
        }
        const isC = e.code === 'KeyC' || e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С';
        if (e.altKey && !e.ctrlKey && !e.shiftKey && isC) {
            e.preventDefault();
            e.stopPropagation();
            toggleMenu();
        }
    }, true);
})();

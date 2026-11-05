// ==UserScript==
// @name         Cookie By Islom
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Плавающее меню просмотра, скрытия, копирования и скачивания всех куки сайта (Alt + C)
// @author       Islom Sadriddinov
// @match        *://*/*
// @grant        GM_cookie
// @grant        GM_registerMenuCommand
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const MODAL_ID = 'islom-floating-cookie-modal';

    // Создание SVG без использования innerHTML (обход блокировки TrustedHTML на Google/YouTube)
    function createEyeIcon(isOpen) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
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
            svg.appendChild(path);
            svg.appendChild(circle);
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
            svg.appendChild(p1);
            svg.appendChild(p2);
            svg.appendChild(p3);
            svg.appendChild(line);
        }
        return svg;
    }

    // Безопасный запрос к GM_cookie с тайм-аутом 250 мс (чтобы меню никогда не зависало)
    function queryGMCookies(details) {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve([]);
                }
            }, 250);

            try {
                if (typeof GM_cookie !== 'undefined' && typeof GM_cookie.list === 'function') {
                    GM_cookie.list(details, (cookies, error) => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timer);
                            resolve(!error && Array.isArray(cookies) ? cookies : []);
                        }
                    });
                } else {
                    clearTimeout(timer);
                    settled = true;
                    resolve([]);
                }
            } catch (e) {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    resolve([]);
                }
            }
        });
    }

    // Сбор всех куки страницы
    async function getAllPageCookies() {
        const cookieMap = new Map();

        const addCookie = (c) => {
            if (!c || !c.name) return;
            const domain = c.domain || window.location.hostname;
            const path = c.path || '/';
            const key = `${c.name}@@${domain}@@${path}`;
            if (!cookieMap.has(key)) {
                cookieMap.set(key, {
                    name: c.name,
                    value: c.value ?? '',
                    domain: domain,
                    path: path,
                    httpOnly: Boolean(c.httpOnly),
                    secure: Boolean(c.secure)
                });
            }
        };

        // 1. Пробуем GM_cookie
        const [byUrl, byDomain] = await Promise.all([
            queryGMCookies({ url: window.location.href }),
            queryGMCookies({ domain: window.location.hostname })
        ]);
        byUrl.forEach(addCookie);
        byDomain.forEach(addCookie);

        // 2. Пробуем CookieStore API
        if (window.cookieStore && typeof window.cookieStore.getAll === 'function') {
            try {
                const storeCookies = await window.cookieStore.getAll();
                storeCookies.forEach(addCookie);
            } catch (e) {}
        }

        // 3. Читаем document.cookie
        try {
            const raw = document.cookie;
            if (raw && raw.trim()) {
                raw.split(';').forEach(pair => {
                    const idx = pair.indexOf('=');
                    const name = idx > -1 ? pair.slice(0, idx).trim() : pair.trim();
                    const value = idx > -1 ? pair.slice(idx + 1).trim() : '';
                    const exists = Array.from(cookieMap.values()).some(item => item.name === name);
                    if (!exists && name) {
                        addCookie({ name, value });
                    }
                });
            }
        } catch (e) {}

        return Array.from(cookieMap.values());
    }

    function closeMenu() {
        const existing = document.getElementById(MODAL_ID);
        if (existing) {
            existing.remove();
        }
    }

    // Перетаскивание окна мышкой за шапку
    function makeDraggable(modal, handle) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            const rect = modal.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            modal.style.transform = 'none';
            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const newLeft = Math.min(Math.max(0, e.clientX - offsetX), window.innerWidth - 80);
            const newTop = Math.min(Math.max(0, e.clientY - offsetY), window.innerHeight - 40);
            modal.style.left = `${newLeft}px`;
            modal.style.top = `${newTop}px`;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    async function openMenu() {
        closeMenu();

        const cookies = await getAllPageCookies();

        const modal = document.createElement('div');
        modal.id = MODAL_ID;
        Object.assign(modal.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#2e2e2e',
            color: '#f0f0f0',
            width: '640px',
            maxWidth: '94vw',
            maxHeight: '78vh',
            borderRadius: '10px',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid #525252',
            zIndex: '2147483647',
            fontFamily: 'Segoe UI, Roboto, Arial, sans-serif'
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            padding: '12px 16px',
            backgroundColor: '#222222',
            borderBottom: '1px solid #444',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move',
            userSelect: 'none'
        });

        const title = document.createElement('div');
        title.textContent = `Cookie By Islom — ${window.location.hostname} (${cookies.length})`;
        Object.assign(title.style, {
            fontWeight: '600',
            fontSize: '14px',
            color: '#e6e6e6'
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            background: 'transparent',
            border: 'none',
            color: '#aaaaaa',
            fontSize: '17px',
            cursor: 'pointer',
            padding: '2px 6px'
        });
        closeBtn.addEventListener('click', closeMenu);

        header.appendChild(title);
        header.appendChild(closeBtn);
        makeDraggable(modal, header);

        const listContainer = document.createElement('div');
        Object.assign(listContainer.style, {
            padding: '12px 16px',
            overflowY: 'auto',
            flex: '1',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
        });

        if (cookies.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = 'На этом сайте доступных куки не найдено.';
            Object.assign(emptyMsg.style, {
                color: '#aaa',
                textAlign: 'center',
                padding: '28px 10px',
                fontSize: '14px'
            });
            listContainer.appendChild(emptyMsg);
        } else {
            cookies.forEach((cookie) => {
                let isHidden = true;
                const maskedValue = '*'.repeat(Math.min(Math.max((cookie.value || '').length, 8), 24));

                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#3a3a3a',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    gap: '10px',
                    border: '1px solid #4d4d4d'
                });

                const info = document.createElement('div');
                Object.assign(info.style, {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: '1',
                    fontSize: '13px'
                });

                const nameSpan = document.createElement('strong');
                nameSpan.textContent = `${cookie.name}: `;
                nameSpan.style.color = '#ffffff';

                const valSpan = document.createElement('span');
                valSpan.textContent = maskedValue;
                Object.assign(valSpan.style, {
                    color: '#cccccc',
                    fontFamily: 'Consolas, monospace',
                    letterSpacing: '1px'
                });

                info.appendChild(nameSpan);
                info.appendChild(valSpan);

                const actions = document.createElement('div');
                Object.assign(actions.style, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexShrink: '0'
                });

                // Кнопка с глазом (слева от Copy)
                const eyeBtn = document.createElement('button');
                eyeBtn.title = 'Показать / скрыть куки';
                Object.assign(eyeBtn.style, {
                    backgroundColor: '#4c4c4c',
                    color: '#e0e0e0',
                    border: '1px solid #666',
                    borderRadius: '4px',
                    padding: '4px 7px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                });
                eyeBtn.appendChild(createEyeIcon(false));

                eyeBtn.addEventListener('click', () => {
                    isHidden = !isHidden;
                    eyeBtn.replaceChildren(createEyeIcon(!isHidden));
                    if (isHidden) {
                        valSpan.textContent = maskedValue;
                        valSpan.style.letterSpacing = '1px';
                    } else {
                        valSpan.textContent = cookie.value;
                        valSpan.style.letterSpacing = 'normal';
                    }
                });

                // Кнопка Copy
                const copyBtn = document.createElement('button');
                copyBtn.textContent = 'Copy';
                Object.assign(copyBtn.style, {
                    backgroundColor: '#555',
                    color: '#fff',
                    border: '1px solid #6e6e6e',
                    borderRadius: '4px',
                    padding: '5px 12px',
                    cursor: 'pointer',
                    fontSize: '12px'
                });

                copyBtn.addEventListener('click', () => {
                    const text = `${cookie.name}=${cookie.value}`;
                    navigator.clipboard.writeText(text).then(() => {
                        copyBtn.textContent = 'Copied!';
                        copyBtn.style.backgroundColor = '#2e7d32';
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy';
                            copyBtn.style.backgroundColor = '#555';
                        }, 1200);
                    });
                });

                actions.appendChild(eyeBtn);
                actions.appendChild(copyBtn);

                row.appendChild(info);
                row.appendChild(actions);
                listContainer.appendChild(row);
            });
        }

        const footer = document.createElement('div');
        Object.assign(footer.style, {
            padding: '12px 16px',
            backgroundColor: '#222222',
            borderTop: '1px solid #444',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'DOWNLOAD ALL';
        Object.assign(downloadBtn.style, {
            width: '100%',
            padding: '10px',
            backgroundColor: '#484848',
            color: '#ffffff',
            border: '1px solid #666',
            borderRadius: '6px',
            fontWeight: 'bold',
            fontSize: '13px',
            cursor: 'pointer',
            letterSpacing: '0.5px'
        });

        downloadBtn.addEventListener('click', () => {
            const jsonContent = JSON.stringify(cookies, null, 2);
            const blob = new Blob([jsonContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `cookies_${window.location.hostname}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        const authorText = document.createElement('div');
        authorText.textContent = 'Made By Islom Sadriddinov';
        Object.assign(authorText.style, {
            fontSize: '12px',
            color: '#888888'
        });

        footer.appendChild(downloadBtn);
        footer.appendChild(authorText);

        modal.appendChild(header);
        modal.appendChild(listContainer);
        modal.appendChild(footer);

        (document.body || document.documentElement).appendChild(modal);
    }

    function toggleMenu() {
        if (document.getElementById(MODAL_ID)) {
            closeMenu();
        } else {
            openMenu();
        }
    }

    // Регистрация кнопки прямо в меню расширения Tampermonkey
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Открыть / Закрыть меню (Alt + C)', toggleMenu);
    }

    // Перехват Alt + C на самом верхнем уровне (capture: true), работает на русской и английской раскладке
    window.addEventListener('keydown', (e) => {
        const isC = e.code === 'KeyC' || e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С';
        if (e.altKey && !e.ctrlKey && !e.shiftKey && isC) {
            e.preventDefault();
            e.stopPropagation();
            toggleMenu();
        }
    }, true);
})();

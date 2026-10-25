// ==UserScript==
// @name         Return YouTube Dislike
// @namespace    https://github.com/Anarios/return-youtube-dislike
// @version      11.8
// @description  Исправлена обрезка счетчика, скрытие в новых интерфейсах YouTube, и запрос к API через fetch()
// @author       Reverse Engineering Lab
// @match        https://www.youtube.com/*
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const API_BASE = 'https://returnyoutubedislikeapi.com';
    const cache = new Map();
    const activeRequests = new Set();

    // 1. Принудительный сброс ширины и скрытия переполнения (Overflow Fix)
    const style = document.createElement('style');
    style.id = 'ryd-layout-fix';
    style.textContent = `
        /* Снимаем ограничение ширины с кнопки дизлайка */
        dislike-button-view-model button,
        dislike-button-view-model button.ytSpecButtonShapeNextIconButton,
        #segmented-dislike-button button,
        ytd-segmented-like-dislike-button-renderer dislike-button-view-model button {
            width: auto !important;
            min-width: 52px !important;
            max-width: none !important;
            padding-right: 12px !important;
            overflow: visible !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        /* Оформление счетчика внутри кнопки */
        .ryd-dislike-text {
            margin-left: 6px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            line-height: normal !important;
            vertical-align: middle !important;
            color: inherit !important;
            user-select: none !important;
            display: inline-block !important;
            white-space: nowrap !important;
        }

        /* Поддержка YouTube Shorts */
        ytd-reel-video-renderer dislike-button-view-model button {
            width: 48px !important;
            padding-right: 0 !important;
        }
        ytd-reel-video-renderer dislike-button-view-model .ryd-dislike-text {
            margin-left: 0 !important;
            margin-top: 4px !important;
            font-size: 12px !important;
            display: block !important;
            text-align: center !important;
        }

        /* Ratio Bar */
        #ryd-bar-container {
            width: 100%;
            height: 2px;
            background-color: #cc0000;
            position: absolute;
            bottom: -3px;
            left: 0;
            border-radius: 2px;
            overflow: hidden;
            pointer-events: none;
        }
        #ryd-bar-likes {
            height: 100%;
            background-color: var(--yt-spec-text-primary, #ffffff);
            transition: width 0.3s ease;
        }
        ytd-segmented-like-dislike-button-renderer,
        segmented-like-dislike-button-view-model {
            position: relative !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. Форматирование чисел (1800 -> 1.8K)
    function formatNumber(num) {
        if (num === null || num === undefined) return '';
        const locale = navigator.language || 'en';
        if (num >= 1e6) return (num / 1e6).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + 'M';
        if (num >= 1e3) return (num / 1e3).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + 'K';
        return num.toLocaleString(locale);
    }

    // 3. Получение ID ролика
    function extractVideoId() {
        const url = window.location.href;
        const watchMatch = url.match(/[?&]v=([^&#]+)/);
        if (watchMatch) return watchMatch[1];
        const shortsMatch = url.match(/\/shorts\/([^&#/?]+)/);
        if (shortsMatch) return shortsMatch[1];
        return null;
    }

    // 4. Поиск DOM-элементов (с запасными вариантами селекторов)
    function getElements() {
        const isShorts = window.location.pathname.startsWith('/shorts/');
        if (isShorts) {
            const activeShort = document.querySelector('ytd-reel-video-renderer[is-active]');
            if (!activeShort) return null;
            const matchesLabel = (el, re) => {
                const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
                return re.test(label);
            };
            const dislikeBtns = Array.from(activeShort.querySelectorAll(
                'dislike-button-view-model button, #dislike-button button'
            )).filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && matchesLabel(el, /dislike|дизлайк|не нравится/i);
            });
            const likeBtns = Array.from(activeShort.querySelectorAll(
                'like-button-view-model button, #like-button button'
            )).filter(el => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && matchesLabel(el, /^(?!.*dislike)(?!.*не нравится).*(like|нравится).*$/i);
            });
            return {
                isShorts: true,
                dislikeBtn: dislikeBtns[0] || null,
                likeBtn: likeBtns[0] || null,
                dislikeBtns,
                likeBtns,
                container: null
            };
        }

        // Возвращает ВСЕ совпадения, у которых реально есть размер на экране —
        // вместо того чтобы гадать, какая из дублирующихся кнопок "настоящая".
        // Дополнительно отсекаем случайные совпадения (например, кнопку Share)
        // по aria-label — это защитило бы от повторения текущего бага.
        function pickAllVisible(selector, labelMustMatch) {
            const matches = document.querySelectorAll(selector);
            const visible = [];
            matches.forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                if (labelMustMatch) {
                    const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
                    if (!labelMustMatch.test(label)) return;
                }
                visible.push(el);
            });
            return visible;
        }

        const dislikeBtns = pickAllVisible(
            'dislike-button-view-model button, ' +
            '#segmented-dislike-button button, ' +
            'ytd-segmented-like-dislike-button-renderer dislike-button-view-model button',
            /dislike|дизлайк|не нравится/i
        );
        const likeBtns = pickAllVisible(
            'like-button-view-model button, ' +
            '#segmented-like-button button, ' +
            'ytd-segmented-like-dislike-button-renderer like-button-view-model button',
            /^(?!.*dislike)(?!.*не нравится).*(like|нравится).*$/i
        );
        const dislikeBtn = dislikeBtns[0] || null;
        const likeBtn = likeBtns[0] || null;
        const container = document.querySelector(
            'ytd-segmented-like-dislike-button-renderer, ' +
            'segmented-like-dislike-button-view-model'
        );

        return dislikeBtn ? { isShorts: false, dislikeBtn, likeBtn, dislikeBtns, likeBtns, container } : null;
    }

    // 5. Запрос данных из RYD API (обычный fetch — без GM_xmlhttpRequest)
    function fetchDislikes(videoId) {
        if (cache.has(videoId) || activeRequests.has(videoId)) return;
        activeRequests.add(videoId);

        fetch(`${API_BASE}/votes?videoId=${videoId}`, { headers: { 'Accept': 'application/json' } })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                activeRequests.delete(videoId);
                cache.set(videoId, data);
                render();
            })
            .catch(err => {
                activeRequests.delete(videoId);
                console.error('[RYD] Ошибка запроса к API:', err);
            });
    }

    // 6. Отрисовка Ratio Bar
    function updateRatioBar(container, likes, dislikes) {
        if (!container) return;
        let barWrapper = container.querySelector('#ryd-bar-container');
        if (!barWrapper) {
            barWrapper = document.createElement('div');
            barWrapper.id = 'ryd-bar-container';
            const likesFill = document.createElement('div');
            likesFill.id = 'ryd-bar-likes';
            barWrapper.appendChild(likesFill);
            container.appendChild(barWrapper);
        }

        const total = (likes || 0) + (dislikes || 0);
        const ratio = total > 0 ? ((likes / total) * 100) : 50;
        const likesFill = barWrapper.querySelector('#ryd-bar-likes');
        if (likesFill) {
            likesFill.style.width = `${ratio}%`;
        }
    }

    // 7. Вставка счетчика
    function setDislikeText(btn, text) {
        if (!btn) return;

        // Удаляем блокирующий класс иконки и добавляем текстовый (если класс присутствует)
        if (btn.classList.contains('ytSpecButtonShapeNextIconButton')) {
            btn.classList.remove('ytSpecButtonShapeNextIconButton');
            btn.classList.add('ytSpecButtonShapeNextText', 'ytSpecButtonShapeNextIconLeading');
        }

        let span = btn.querySelector('.ryd-dislike-text');
        if (!span) {
            span = document.createElement('span');
            span.className = 'ryd-dislike-text';
            const touchShape = btn.querySelector('yt-touch-feedback-shape, .yt-spec-touch-feedback-shape');
            if (touchShape) {
                btn.insertBefore(span, touchShape);
            } else {
                btn.appendChild(span);
            }
        }
        if (span.textContent !== text) {
            span.textContent = text;
        }
    }

    // 8. Главный рендер-цикл
    function render() {
        const videoId = extractVideoId();
        if (!videoId) return;

        if (!cache.has(videoId)) {
            fetchDislikes(videoId);
            return;
        }

        const elements = getElements();
        if (!elements || !elements.dislikeBtn) return;

        const data = cache.get(videoId);
        const isDisliked = elements.dislikeBtn.getAttribute('aria-pressed') === 'true';
        const isLiked = elements.likeBtn && elements.likeBtn.getAttribute('aria-pressed') === 'true';

        let baseDislikes = data.dislikes || 0;
        let baseLikes = data.likes || 0;

        if (isDisliked) baseDislikes += 1;
        if (isLiked) baseLikes += 1;

        setDislikeText(elements.dislikeBtn, formatNumber(baseDislikes));
        elements.dislikeBtn.setAttribute('title', `${baseDislikes.toLocaleString()} дизлайков`);
        desiredText.set(elements.dislikeBtn, formatNumber(baseDislikes));

        // На случай если реально видимая кнопка — не первая в списке,
        // обновляем текст во всех найденных дублях сразу.
        (elements.dislikeBtns || []).forEach(btn => {
            setDislikeText(btn, formatNumber(baseDislikes));
            btn.setAttribute('title', `${baseDislikes.toLocaleString()} дизлайков`);
            desiredText.set(btn, formatNumber(baseDislikes));
        });

        if (!elements.isShorts && elements.container) {
            updateRatioBar(elements.container, baseLikes, baseDislikes);
        }

        // YouTube использует <yt-smartimation> для анимации лайка/дизлайка —
        // он периодически перестраивает содержимое кнопок и стирает наш span.
        // Следим за этим блоком и мгновенно восстанавливаем текст.
        watchSmartimation(elements.dislikeBtns.length ? elements.dislikeBtns : [elements.dislikeBtn]);
    }

    // Хранит АКТУАЛЬНОЕ желаемое значение текста для каждой кнопки.
    // Наблюдатель всегда читает это значение в момент срабатывания,
    // а не то, что было на момент подписки — иначе получается мигание
    // между старым и новым числом.
    const desiredText = new WeakMap();
    const observedButtons = new WeakSet();
    function watchSmartimation(buttons) {
        buttons.forEach(btn => {
            if (!btn || observedButtons.has(btn)) return;
            observedButtons.add(btn);

            let pending = false;
            const reapply = () => {
                if (pending) return;
                pending = true;
                // Ждём конца текущего кадра/анимации, а не бьём по DOM в тот же тик.
                setTimeout(() => {
                    pending = false;
                    const text = desiredText.get(btn);
                    if (text !== undefined && btn.querySelector('.ryd-dislike-text')?.textContent !== text) {
                        setDislikeText(btn, text);
                    }
                }, 220); // чуть дольше типичной анимации клика (~150-200мс)
            };

            // Следим только за добавлением/удалением узлов, НЕ за атрибутами —
            // атрибуты меняются на каждый кадр анимации и раньше вызывали
            // слишком частые срабатывания, обрывающие саму анимацию.
            const mo = new MutationObserver(reapply);
            mo.observe(btn, { childList: true, subtree: true });

            const smartimationHost = btn.closest('ytd-segmented-like-dislike-button-renderer, segmented-like-dislike-button-view-model, #top-level-buttons-computed');
            const smartimation = smartimationHost?.querySelector('yt-smartimation');
            if (smartimation) {
                const smMo = new MutationObserver(reapply);
                smMo.observe(smartimation, { childList: true, subtree: true });
            }
        });
    }

    // Регулярный опрос и события переходов
    setInterval(render, 300);
    window.addEventListener('yt-navigate-finish', () => {
        cache.clear();
        render();
    });
    window.addEventListener('yt-page-data-updated', render);
    window.addEventListener('load', render);
})();

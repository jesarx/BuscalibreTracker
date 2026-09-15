// ==UserScript==
// @name         Buscalibre Wishlist Price Tracker
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Rastrea el historial de precios de tu lista de deseos en Buscalibre, con alertas visuales de bajadas y mínimos históricos, ordenamiento por precio y gráfica en la página de cada libro
// @author       Eduardo
// @homepageURL  https://jesarx.github.io/BuscalibreTracker/
// @supportURL   https://github.com/jesarx/BuscalibreTracker/issues
// @downloadURL  https://raw.githubusercontent.com/jesarx/BuscalibreTracker/main/buscalibre-price-tracker.user.js
// @updateURL    https://raw.githubusercontent.com/jesarx/BuscalibreTracker/main/buscalibre-price-tracker.user.js
// @match        https://www.buscalibre.com.mx/v2/u/dashboard*
// @match        https://www.buscalibre.com.mx/*/p/*
// @match        https://jesarx.github.io/BuscalibreTracker/*
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    // Configuración
    // ─────────────────────────────────────────────
    const CONFIG = {
        storageKey: 'buscalibre_price_history_v2',
        legacyStorageKey: 'buscalibre_price_history', // migración desde v1.x
        maxHistoryDays: 365,        // días de historial que se conservan
        dropThreshold: 0.15,        // bajada "sustancial": ≥15% por debajo del promedio
        minEntriesForBadges: 3,     // mínimo de registros antes de mostrar insignias
        unseenGraceDays: 45,        // días sin ver un libro antes de borrar su historial
        sortStorageKey: 'buscalibre_sort_v1', // criterio de orden elegido
        debug: false,
    };

    const COLORS = {
        low:        '#1a7a4c', // verde: mínimo histórico
        lowBg:      'rgba(26, 122, 76, 0.06)',
        drop:       '#1d6fa5', // azul: bajada sustancial
        dropBg:     'rgba(29, 111, 165, 0.05)',
        unavailable:'#8a8a8a', // gris: no disponible
        line:       'rgb(56, 178, 172)',
        fill:       'rgba(56, 178, 172, 0.18)',
        pointMin:   '#e6a817', // dorado: punto mínimo en la gráfica
        pointMax:   '#c0504d',
        pointGray:  '#b5b5b5',
    };

    const log = (...args) => { if (CONFIG.debug) console.log('[PriceTracker]', ...args); };

    const createdCharts = new Map();

    // ─────────────────────────────────────────────
    // Estilos globales
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('bpt-styles')) return;
        const style = document.createElement('style');
        style.id = 'bpt-styles';
        style.textContent = `
            /* ── Fix: el sitio da altura fija a las tarjetas y nuestra
                  gráfica desborda, cortando el contenido inferior ── */
            .productosLista .productoLista,
            .v2018 .productosLista .productoLista {
                height: auto !important;
                min-height: 0 !important;
                overflow: visible !important;
            }
            .productosLista .productoLista .info-div {
                height: auto !important;
                min-height: 0 !important;
                overflow: visible !important;
                padding-bottom: 10px;
            }

            /* ── Layout blindado del bloque de gráfica ──
                  clear:both lo obliga a caer DEBAJO de las columnas
                  flotadas del sitio (precio/botón sin clearfix), y el
                  flex interno impide que cualquier regla de Buscalibre
                  encime la fila de estadísticas sobre el canvas ── */
            .productoLista .price-chart-container {
                clear: both !important;
                float: none !important;
                display: flex !important;
                flex-direction: column !important;
                position: relative !important;
                width: auto !important;
                height: auto !important;
                min-height: 0 !important;
                overflow: visible !important;
            }
            .productoLista .bpt-canvas-wrap {
                position: relative !important;
                flex: 0 0 160px !important;
                height: 160px !important;
                width: 100% !important;
                overflow: hidden !important;
            }
            .productoLista .bpt-stats {
                display: block !important;
                position: static !important;
                float: none !important;
                flex: 0 0 auto !important;
                margin-top: 8px !important;
                font-size: 12px;
                line-height: 1.6;
            }

            /* ── Mínimo histórico: muy notorio para escaneo rápido ── */
            .productoLista.bpt-atl {
                background: linear-gradient(90deg,
                    rgba(26, 122, 76, 0.18),
                    rgba(26, 122, 76, 0.05) 60%) !important;
                box-shadow: inset 6px 0 0 ${COLORS.low},
                            0 0 0 2px rgba(26, 122, 76, 0.4) !important;
                border-radius: 8px;
            }

            /* ── Bajada sustancial (sin ser mínimo histórico) ── */
            .productoLista.bpt-drop {
                background: rgba(29, 111, 165, 0.07) !important;
                box-shadow: inset 6px 0 0 ${COLORS.drop} !important;
                border-radius: 8px;
            }

            /* ── Destello al llegar desde un link del panel ── */
            @keyframes bpt-flash {
                0%, 50% { outline: 4px solid rgba(230, 168, 23, 0.95); outline-offset: 2px; }
                100%    { outline: 4px solid rgba(230, 168, 23, 0); outline-offset: 2px; }
            }
            .productoLista.bpt-flash { animation: bpt-flash 0.8s ease-out 3; }

            /* ── Lista de mínimos históricos en el panel de resumen ── */
            #bpt-summary .bpt-low-list {
                margin: 6px 0 0;
                padding: 0;
                list-style: none;
                columns: 2;
                column-gap: 30px;
            }
            #bpt-summary .bpt-low-list li {
                padding: 3px 0;
                break-inside: avoid;
            }
            #bpt-summary .bpt-low-link {
                color: ${COLORS.low};
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
            }
            #bpt-summary .bpt-low-link:hover { text-decoration: underline; }
            #bpt-summary .bpt-drop-link {
                color: ${COLORS.drop};
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
            }
            #bpt-summary .bpt-drop-link:hover { text-decoration: underline; }
            #bpt-summary .bpt-low-price {
                color: #777;
                font-weight: 400;
                margin-left: 6px;
                white-space: nowrap;
            }
            @media (max-width: 700px) {
                #bpt-summary .bpt-low-list { columns: 1; }
            }

            /* ── Barra de orden ── */
            #bpt-summary .bpt-sort-bar {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid #f0f0f0;
            }
            #bpt-summary .bpt-sort-label {
                font-weight: 600;
                color: #555;
                margin-right: 2px;
            }
            #bpt-summary .bpt-sort-btn {
                padding: 5px 11px;
                border: 1px solid #d8d8d8;
                border-radius: 999px;
                background: #fff;
                color: #444;
                cursor: pointer;
                font-size: 12px;
                line-height: 1.4;
                font-family: inherit;
                transition: all .15s ease;
            }
            #bpt-summary .bpt-sort-btn:hover {
                border-color: #ff5a00;
                color: #ff5a00;
            }
            #bpt-summary .bpt-sort-btn.bpt-sort-active {
                background: #ff5a00;
                border-color: #ff5a00;
                color: #fff;
                font-weight: 600;
            }
            /* Numeración de posición al ordenar (1., 2., 3. …) */
            .productoLista.bpt-ranked { position: relative; }
            .productoLista .bpt-rank {
                position: absolute;
                top: 6px;
                left: 6px;
                z-index: 3;
                min-width: 22px;
                height: 22px;
                padding: 0 6px;
                border-radius: 999px;
                background: rgba(24, 43, 58, 0.85);
                color: #fff;
                font-size: 12px;
                font-weight: 700;
                line-height: 22px;
                text-align: center;
                pointer-events: none;
            }
            .productoLista.bpt-atl .bpt-rank { background: ${COLORS.low}; }
            .productoLista.bpt-drop .bpt-rank { background: ${COLORS.drop}; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ─────────────────────────────────────────────
    // Almacenamiento e historial
    // ─────────────────────────────────────────────
    function getPriceHistory() {
        try {
            const stored = GM_getValue(CONFIG.storageKey, null);
            if (stored) return JSON.parse(stored);

            // Migración desde el formato antiguo
            const legacy = GM_getValue(CONFIG.legacyStorageKey, null);
            if (legacy) {
                const old = JSON.parse(legacy);
                const migrated = {};
                for (const id in old) {
                    migrated[id] = {
                        title: old[id].title,
                        lastSeen: todayStr(),
                        prices: (old[id].prices || []).map(p => ({
                            date: p.date,
                            price: p.price,
                            available: true, // asumimos disponible en datos viejos
                        })),
                    };
                }
                savePriceHistory(migrated);
                log('Historial migrado desde v1:', Object.keys(migrated).length, 'libros');
                return migrated;
            }
            return {};
        } catch (e) {
            console.error('[PriceTracker] Error leyendo historial:', e);
            return {};
        }
    }

    function savePriceHistory(history) {
        GM_setValue(CONFIG.storageKey, JSON.stringify(history));
    }

    function todayStr() {
        // Fecha local (no UTC) para evitar registros desfasados por zona horaria
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function cleanHistory(history) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - CONFIG.maxHistoryDays);
        const unseenCutoff = new Date();
        unseenCutoff.setDate(unseenCutoff.getDate() - CONFIG.unseenGraceDays);

        for (const id in history) {
            const book = history[id];
            book.prices = (book.prices || []).filter(p => new Date(p.date) > cutoff);

            // Sólo borrar libros que llevan mucho tiempo sin aparecer
            // (evita perder historial por paginación o cargas parciales)
            const lastSeen = book.lastSeen ? new Date(book.lastSeen) : null;
            if (book.prices.length === 0 || (lastSeen && lastSeen < unseenCutoff)) {
                delete history[id];
                log('Historial eliminado:', id);
            }
        }
        return history;
    }

    // ─────────────────────────────────────────────
    // Utilidades de precios y estadísticas
    // ─────────────────────────────────────────────
    function formatPrice(price) {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price);
    }

    function parsePrice(text) {
        // Maneja "$ 1,234.56", "$391.98", etc.
        const cleaned = text.replace(/[^0-9.,]/g, '').replace(/,/g, '');
        const price = parseFloat(cleaned);
        return isNaN(price) ? null : price;
    }

    // Estadísticas calculadas SÓLO con registros de días en que el libro
    // estaba disponible (los precios de "no disponible" suelen ser basura).
    function computeStats(prices) {
        const available = prices.filter(p => p.available !== false);
        if (available.length === 0) return null;

        const values = available.map(p => p.price);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const first = available[0].price;
        const last = available[available.length - 1].price;

        return {
            count: available.length,
            min, max, avg, first,
            current: last,
            vsAvg: (last - avg) / avg,       // negativo = por debajo del promedio
            vsFirst: (last - first) / first, // cambio desde el primer registro
            isAllTimeLow: last <= min + 0.005,
        };
    }

    // ─────────────────────────────────────────────
    // Detección de disponibilidad
    // ─────────────────────────────────────────────
    function isUnavailable(item) {
        // La leyenda "No disponible actualmente" aparece dentro de .add-cart
        // (verificado contra el DOM real de Buscalibre). Fallback al texto
        // completo de la tarjeta por si cambian la estructura.
        const addCart = item.querySelector('.add-cart');
        if (addCart) return /no\s+disponible/i.test(addCart.textContent);
        return /no\s+disponible\s+actualmente/i.test(item.textContent);
    }

    // ─────────────────────────────────────────────
    // Insignias y resaltado de tarjetas
    // ─────────────────────────────────────────────
    function makeBadge(text, color) {
        const badge = document.createElement('span');
        badge.className = 'bpt-badge';
        badge.textContent = text;
        badge.style.cssText = `
            display: inline-block;
            padding: 3px 10px;
            margin: 0 6px 4px 0;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            background: ${color};
            letter-spacing: 0.2px;
            vertical-align: middle;
        `;
        return badge;
    }

    function decorateItem(item, stats, unavailable) {
        // Limpiar decoración previa (en reprocesos)
        item.querySelectorAll('.bpt-badge-row').forEach(el => el.remove());
        item.classList.remove('bpt-atl', 'bpt-drop');

        const badgeRow = document.createElement('div');
        badgeRow.className = 'bpt-badge-row';
        badgeRow.style.cssText = 'margin: 6px 0 2px 0;';

        if (unavailable) {
            // Sin resaltado especial: el precio mostrado no es confiable
            badgeRow.appendChild(makeBadge('No disponible', COLORS.unavailable));
        } else if (stats && stats.count >= CONFIG.minEntriesForBadges) {
            if (stats.isAllTimeLow) {
                badgeRow.appendChild(makeBadge('★ Mínimo histórico', COLORS.low));
                item.classList.add('bpt-atl');
            }
            if (stats.vsAvg <= -CONFIG.dropThreshold) {
                const pct = Math.round(Math.abs(stats.vsAvg) * 100);
                badgeRow.appendChild(makeBadge(`▼ ${pct}% bajo el promedio`, COLORS.drop));
                if (!stats.isAllTimeLow) item.classList.add('bpt-drop');
            }
        }

        if (badgeRow.children.length > 0) {
            const anchor = item.querySelector('.info-div') || item;
            anchor.insertBefore(badgeRow, anchor.firstChild);
        }
    }

    // ─────────────────────────────────────────────
    // Gráfica de precios
    // ─────────────────────────────────────────────
    function destroyExistingChart(bookId) {
        if (createdCharts.has(bookId)) {
            try { createdCharts.get(bookId).destroy(); } catch (e) { /* ignore */ }
            createdCharts.delete(bookId);
        }
    }

    function statChip(label, value, color) {
        return `
            <span style="display:inline-block; margin:2px 10px 2px 0; white-space:nowrap;">
                <span style="color:#999;">${label}</span>
                <strong style="color:${color || '#444'};">${value}</strong>
            </span>`;
    }

    // Instancia una gráfica de líneas de Chart.js sobre un <canvas>.
    // Compartida por la lista de deseos y la página de cada libro.
    function buildLineChart(canvas, entries, lineColor, fillColor) {
        const labels = entries.map(p => new Date(p.date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));
        const prices = entries.map(p => p.price);

        // Color por punto: gris si no disponible, dorado si es el mínimo
        const availValues = entries.filter(p => p.available !== false).map(p => p.price);
        const minAvail = availValues.length ? Math.min(...availValues) : null;
        const pointColors = entries.map(p => {
            if (p.available === false) return COLORS.pointGray;
            if (minAvail !== null && Math.abs(p.price - minAvail) < 0.005) return COLORS.pointMin;
            return lineColor;
        });
        const pointRadii = entries.map(p =>
            (p.available !== false && minAvail !== null && Math.abs(p.price - minAvail) < 0.005) ? 5 : 2.5
        );

        const ctx = canvas.getContext('2d');
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Precio',
                    data: prices,
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    tension: 0.15,
                    pointRadius: pointRadii,
                    pointHoverRadius: 6,
                    pointBackgroundColor: pointColors,
                    pointBorderColor: pointColors,
                    fill: true,
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const entry = entries[context.dataIndex];
                                const parts = [formatPrice(context.parsed.y)];
                                if (entry.available === false) parts.push('(no disponible)');
                                if (context.dataIndex > 0) {
                                    const prev = prices[context.dataIndex - 1];
                                    const diff = context.parsed.y - prev;
                                    if (Math.abs(diff) > 0.01) {
                                        parts.push(`${diff > 0 ? '+' : '−'}${formatPrice(Math.abs(diff))} vs día anterior`);
                                    }
                                }
                                return parts.join(' ');
                            },
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        grace: '5%',
                        ticks: {
                            callback: (value) => formatPrice(value),
                            font: { size: 10 },
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' },
                    },
                    x: {
                        ticks: {
                            maxTicksLimit: 12,
                            maxRotation: 45,
                            font: { size: 9 },
                        },
                        grid: { display: false },
                    },
                },
            },
        });
    }

    function createPriceChart(bookId, bookHistory, stats, unavailable, highlight) {
        // Fondo y borde del contenedor según el estado del libro
        let bg = '#fafafa', border = '#e8e8e8';
        if (unavailable) {
            bg = '#f2f2f2';
        } else if (highlight === 'atl') {
            bg = 'rgba(26, 122, 76, 0.07)';
            border = 'rgba(26, 122, 76, 0.35)';
        } else if (highlight === 'drop') {
            bg = 'rgba(29, 111, 165, 0.05)';
            border = 'rgba(29, 111, 165, 0.25)';
        }

        const container = document.createElement('div');
        container.className = 'price-chart-container';
        container.dataset.bookId = bookId;
        // El layout (clear, flex, alturas) vive en las clases inyectadas
        // por injectStyles con !important; aquí sólo lo cosmético que
        // varía según el estado del libro.
        container.style.cssText = `
            margin: 10px 0;
            padding: 12px;
            background: ${bg};
            border: 1px solid ${border};
            border-radius: 8px;
            ${unavailable ? 'opacity: 0.75;' : ''}
        `;

        // La tarjeta completa está envuelta en un <a>: sin esto, cualquier
        // clic sobre la gráfica navegaría a la página del producto.
        container.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // Wrapper con altura fija: es a ESTE elemento al que Chart.js
        // ajustará el canvas, dejando intacto el resto del contenedor.
        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'bpt-canvas-wrap';
        const canvas = document.createElement('canvas');
        canvas.id = `price-chart-${bookId}`;
        canvasWrap.appendChild(canvas);
        container.appendChild(canvasWrap);

        // Fila de estadísticas
        if (stats) {
            const statsDiv = document.createElement('div');
            statsDiv.className = 'bpt-stats';
            const trendColor = stats.vsFirst < 0 ? COLORS.low : (stats.vsFirst > 0 ? COLORS.pointMax : '#444');
            const trendArrow = stats.vsFirst < 0 ? '▼' : (stats.vsFirst > 0 ? '▲' : '—');
            statsDiv.innerHTML =
                statChip('Actual:', formatPrice(stats.current), stats.isAllTimeLow ? COLORS.low : '#222') +
                statChip('Mín:', formatPrice(stats.min), COLORS.pointMin) +
                statChip('Máx:', formatPrice(stats.max), COLORS.pointMax) +
                statChip('Promedio:', formatPrice(stats.avg)) +
                statChip('Tendencia:', `${trendArrow} ${Math.abs(Math.round(stats.vsFirst * 100))}%`, trendColor);
            container.appendChild(statsDiv);
        }

        // Colores de línea y relleno según el estado del libro
        const lineColor = unavailable ? COLORS.pointGray
            : highlight === 'atl' ? COLORS.low
            : COLORS.line;
        const fillColor = unavailable ? 'rgba(160, 160, 160, 0.12)'
            : highlight === 'atl' ? 'rgba(26, 122, 76, 0.15)'
            : COLORS.fill;

        setTimeout(() => {
            try {
                destroyExistingChart(bookId);
                const chart = buildLineChart(canvas, bookHistory.prices, lineColor, fillColor);
                createdCharts.set(bookId, chart);
            } catch (error) {
                console.error(`[PriceTracker] Error creando gráfica para ${bookId}:`, error);
                container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">No se pudo cargar la gráfica</div>';
            }
        }, 150);

        return container;
    }

    // ─────────────────────────────────────────────
    // Ordenamiento de las tarjetas
    // ─────────────────────────────────────────────
    // Reordenamos las tarjetas reales (no una lista aparte) para que el
    // orden elegido conserve gráfica, insignias y botón de compra.
    const SORTS = {
        original: { label: 'Original', cmp: null },
        priceAsc: { label: '💲 Precio ↑', cmp: (a, b) => a.price - b.price },
        priceDesc: { label: '💲 Precio ↓', cmp: (a, b) => b.price - a.price },
        // vsAvg es negativo cuando el precio está bajo el promedio:
        // el más negativo (mayor bajada) va primero.
        drop: { label: '▼ Mayor bajada', cmp: (a, b) => a.vsAvg - b.vsAvg },
        vsMax: { label: '📉 Vs. su máximo', cmp: (a, b) => a.vsMax - b.vsMax },
    };
    const DEFAULT_SORT = 'original';

    // Evita que nuestro propio reordenamiento dispare el MutationObserver
    // y provoque un reproceso en bucle.
    let suppressObserver = false;

    function getSortKey() {
        try {
            const stored = GM_getValue(CONFIG.sortStorageKey, DEFAULT_SORT);
            return SORTS[stored] ? stored : DEFAULT_SORT;
        } catch (e) {
            return DEFAULT_SORT;
        }
    }

    function setSortKey(key) {
        GM_setValue(CONFIG.sortStorageKey, SORTS[key] ? key : DEFAULT_SORT);
    }

    // Guarda en el dataset los valores por los que se puede ordenar.
    function tagSortData(item, index, price, stats, unavailable) {
        if (item.dataset.bptIndex === undefined) item.dataset.bptIndex = String(index);
        item.dataset.bptPrice = String(price);
        item.dataset.bptUnavail = unavailable ? '1' : '0';
        item.dataset.bptVsavg = stats ? String(stats.vsAvg) : '0';
        item.dataset.bptVsmax = stats && stats.max > 0
            ? String((stats.current - stats.max) / stats.max)
            : '0';
    }

    function readSortData(item, fallbackIndex) {
        const num = (v, def) => {
            const n = parseFloat(v);
            return isNaN(n) ? def : n;
        };
        return {
            el: item,
            index: num(item.dataset.bptIndex, fallbackIndex),
            price: num(item.dataset.bptPrice, Infinity),
            vsAvg: num(item.dataset.bptVsavg, 0),
            vsMax: num(item.dataset.bptVsmax, 0),
            unavailable: item.dataset.bptUnavail === '1',
            // Sin datos propios no puede competir en el orden: va al final.
            untracked: item.dataset.bptPrice === undefined,
        };
    }

    function applySort(key) {
        const container = document.querySelector('.productosLista');
        if (!container) return;

        const cards = Array.from(container.children).filter(
            el => el.classList && el.classList.contains('productoLista')
        );
        if (cards.length === 0) return;

        const sortKey = SORTS[key] ? key : DEFAULT_SORT;
        const cmp = SORTS[sortKey].cmp;
        const rows = cards.map((el, i) => readSortData(el, i));

        rows.sort((a, b) => {
            // "Original" devuelve la lista tal cual la entrega el sitio,
            // sin mover siquiera los agotados.
            if (!cmp) return a.index - b.index;

            // Con un criterio activo, los no rastreados y los no disponibles
            // van al final: su precio no es comparable con el resto.
            if (a.untracked !== b.untracked) return a.untracked ? 1 : -1;
            if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1;

            if (!a.untracked && !a.unavailable) {
                const r = cmp(a, b);
                if (r !== 0) return r;
            }
            return a.index - b.index; // desempate: orden original
        });

        // Reordenar en el DOM. Mover un <canvas> conserva su contenido,
        // así que las gráficas ya dibujadas sobreviven al cambio.
        suppressObserver = true;
        const frag = document.createDocumentFragment();
        rows.forEach(r => frag.appendChild(r.el));
        container.appendChild(frag);

        // Numerar sólo cuando hay un orden aplicado
        rows.forEach((r, i) => {
            const old = r.el.querySelector('.bpt-rank');
            if (old) old.remove();
            r.el.classList.remove('bpt-ranked');

            if (sortKey === DEFAULT_SORT || r.untracked || r.unavailable) return;
            const badge = document.createElement('span');
            badge.className = 'bpt-rank';
            badge.textContent = String(i + 1);
            r.el.classList.add('bpt-ranked');
            r.el.appendChild(badge);
        });

        // Liberamos el observador en el siguiente tick, ya asentado el DOM
        setTimeout(() => { suppressObserver = false; }, 0);
        log(`Orden aplicado: ${sortKey}`);
    }

    // ─────────────────────────────────────────────
    // Panel de resumen (arriba de la lista)
    // ─────────────────────────────────────────────
    function renderSummaryPanel(container, summary) {
        let panel = document.getElementById('bpt-summary');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'bpt-summary';
            panel.style.cssText = `
                margin: 12px 0;
                padding: 14px 16px;
                background: #fff;
                border: 1px solid #e4e4e4;
                border-radius: 10px;
                font-size: 13px;
                line-height: 1.7;
                box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            `;
            container.parentElement.insertBefore(panel, container);
        }

        const sortedLows = [...summary.allTimeLows].sort((a, b) => a.price - b.price);
        const lowsHtml = sortedLows.length
            ? `<div style="margin-top:10px;">
                 <strong style="color:${COLORS.low};">★ En mínimo histórico</strong>
                 <ul class="bpt-low-list">
                   ${sortedLows.map(b => `
                     <li>
                       <a class="bpt-low-link" data-target="producto${b.id}">${escapeHtml(b.title)}</a>
                       <span class="bpt-low-price">${formatPrice(b.price)}</span>
                     </li>`).join('')}
                 </ul>
               </div>`
            : '';

        // Bajadas fuertes ordenadas por porcentaje de descuento (mayor primero)
        const sortedDrops = [...summary.bigDrops].sort((a, b) => b.pct - a.pct);
        const dropsHtml = sortedDrops.length
            ? `<div style="margin-top:10px;">
                 <strong style="color:${COLORS.drop};">▼ Con bajada fuerte</strong>
                 <ul class="bpt-low-list">
                   ${sortedDrops.map(b => `
                     <li>
                       <a class="bpt-drop-link" data-target="producto${b.id}">${escapeHtml(b.title)}</a>
                       <span class="bpt-low-price">${formatPrice(b.price)} · −${b.pct}%</span>
                     </li>`).join('')}
                 </ul>
               </div>`
            : '';

        const currentSort = getSortKey();
        const sortHtml = `
            <div class="bpt-sort-bar">
                <span class="bpt-sort-label">Ordenar por:</span>
                ${Object.entries(SORTS).map(([key, s]) => `
                    <button class="bpt-sort-btn${key === currentSort ? ' bpt-sort-active' : ''}"
                            data-sort="${key}">${s.label}</button>`).join('')}
            </div>`;

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <div>
                    <strong style="font-size:14px;">📚 Rastreador de precios</strong>
                    &nbsp;·&nbsp; ${summary.tracked} libros
                    &nbsp;·&nbsp; <span style="color:${COLORS.low};">${summary.lows} en mínimo histórico</span>
                    &nbsp;·&nbsp; <span style="color:${COLORS.drop};">${summary.drops} con bajada fuerte</span>
                    &nbsp;·&nbsp; <span style="color:${COLORS.unavailable};">${summary.unavailable} no disponibles</span>
                </div>
                <div>
                    <button id="bpt-export" style="padding:5px 12px; margin-right:6px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; font-size:12px;">Exportar historial</button>
                    <button id="bpt-import" style="padding:5px 12px; border:1px solid #ccc; border-radius:6px; background:#fff; cursor:pointer; font-size:12px;">Importar</button>
                </div>
            </div>
            ${lowsHtml}
            ${dropsHtml}
            ${sortHtml}
        `;

        panel.querySelector('#bpt-export').addEventListener('click', exportHistory);
        panel.querySelector('#bpt-import').addEventListener('click', importHistory);

        panel.querySelectorAll('.bpt-sort-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.sort;
                setSortKey(key);
                panel.querySelectorAll('.bpt-sort-btn').forEach(b =>
                    b.classList.toggle('bpt-sort-active', b === btn));
                applySort(key);
            });
        });

        panel.querySelectorAll('.bpt-low-link, .bpt-drop-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const card = document.getElementById(link.dataset.target);
                if (!card) return;
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Reiniciar la animación de destello si ya estaba aplicada
                card.classList.remove('bpt-flash');
                void card.offsetWidth;
                card.classList.add('bpt-flash');
                setTimeout(() => card.classList.remove('bpt-flash'), 3000);
            });
        });
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function exportHistory() {
        const data = GM_getValue(CONFIG.storageKey, '{}');
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `buscalibre-precios-${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importHistory() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const imported = JSON.parse(reader.result);
                    const current = getPriceHistory();
                    // Fusionar: unión de registros por fecha, sin duplicados
                    for (const id in imported) {
                        if (!current[id]) {
                            current[id] = imported[id];
                        } else {
                            const dates = new Set(current[id].prices.map(p => p.date));
                            for (const entry of imported[id].prices || []) {
                                if (!dates.has(entry.date)) current[id].prices.push(entry);
                            }
                            current[id].prices.sort((a, b) => a.date.localeCompare(b.date));
                        }
                    }
                    savePriceHistory(current);
                    alert('Historial importado y fusionado. Recarga la página para ver los cambios.');
                } catch (e) {
                    alert('No se pudo importar el archivo: ' + e.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    // ─────────────────────────────────────────────
    // Procesamiento principal
    // ─────────────────────────────────────────────
    function processWishlistItems() {
        log('Procesando lista de deseos...');
        const history = getPriceHistory();
        const today = todayStr();
        const summary = { tracked: 0, lows: 0, drops: 0, unavailable: 0, allTimeLows: [], bigDrops: [] };

        const bookItems = document.querySelectorAll('.productoLista');
        if (bookItems.length === 0) return;

        bookItems.forEach((item, itemIndex) => {
            const bookId = item.getAttribute('data-id_producto');
            const priceElement = item.querySelector('.precioAhora');
            if (!bookId || !priceElement) return;

            const price = parsePrice(priceElement.textContent);
            if (price === null) return;

            const titleElement = item.querySelector('.title');
            const title = titleElement ? titleElement.textContent.trim() : 'Libro sin título';
            const unavailable = isUnavailable(item);

            summary.tracked++;
            if (unavailable) summary.unavailable++;

            // Registrar / actualizar historial
            if (!history[bookId]) history[bookId] = { title, prices: [] };
            const book = history[bookId];
            book.title = title;
            book.lastSeen = today;

            const todayEntry = book.prices.find(p => p.date === today);
            if (!todayEntry) {
                book.prices.push({ date: today, price, available: !unavailable });
            } else {
                todayEntry.price = price;
                todayEntry.available = !unavailable;
            }
            book.prices.sort((a, b) => a.date.localeCompare(b.date));

            // Estadísticas e insignias
            const stats = computeStats(book.prices);
            decorateItem(item, stats, unavailable);
            tagSortData(item, itemIndex, price, stats, unavailable);

            // Tipo de resaltado (misma lógica que decorateItem)
            let highlight = null;
            if (!unavailable && stats && stats.count >= CONFIG.minEntriesForBadges) {
                if (stats.isAllTimeLow) {
                    highlight = 'atl';
                    summary.lows++;
                    summary.allTimeLows.push({ id: bookId, title, price: stats.current });
                }
                if (stats.vsAvg <= -CONFIG.dropThreshold) {
                    summary.drops++;
                    if (!highlight) {
                        highlight = 'drop';
                        // Sólo listar las que no están ya en mínimos históricos
                        summary.bigDrops.push({
                            id: bookId,
                            title,
                            price: stats.current,
                            pct: Math.round(Math.abs(stats.vsAvg) * 100),
                        });
                    }
                }
            }

            // Gráfica (si hay al menos 2 registros)
            if (book.prices.length > 1) {
                const infoDiv = item.querySelector('.info-div');
                if (!infoDiv) return;

                const existing = item.querySelector('.price-chart-container');
                if (existing) {
                    // Reemplazar sólo si los datos cambiaron (nueva entrada de hoy)
                    if (existing.dataset.entries === String(book.prices.length) &&
                        existing.dataset.lastPrice === String(price)) return;
                    destroyExistingChart(bookId);
                    existing.remove();
                }

                const chart = createPriceChart(bookId, book, stats, unavailable, highlight);
                chart.dataset.entries = String(book.prices.length);
                chart.dataset.lastPrice = String(price);
                infoDiv.appendChild(chart);
            }
        });

        // Panel de resumen
        const listContainer = document.querySelector('.productosLista');
        if (listContainer) renderSummaryPanel(listContainer, summary);

        // Reaplicar el orden elegido: la lista pudo crecer (paginación) o
        // pudieron cambiar los precios desde la última vez.
        applySort(getSortKey());

        savePriceHistory(cleanHistory(history));
        log(`Rastreando ${summary.tracked} libros. Mínimos: ${summary.lows}, bajadas: ${summary.drops}`);
    }

    // ─────────────────────────────────────────────
    // Arranque y observadores
    // ─────────────────────────────────────────────
    let processingTimeout;
    function debouncedProcessing() {
        clearTimeout(processingTimeout);
        processingTimeout = setTimeout(processWishlistItems, 800);
    }

    let checkInterval = null;
    function waitForWishlist() {
        if (checkInterval) clearInterval(checkInterval);
        let attempts = 0;

        checkInterval = setInterval(() => {
            attempts++;
            const container = document.querySelector('.productosLista');
            const items = document.querySelectorAll('.productoLista');

            if (container && items.length > 0) {
                clearInterval(checkInterval);
                checkInterval = null;
                setTimeout(processWishlistItems, 400);

                const observer = new MutationObserver((mutations) => {
                    // Nuestro propio reordenamiento mueve las tarjetas: no
                    // debe contar como cambio externo (provocaría un bucle).
                    if (suppressObserver) return;

                    // Ignorar mutaciones provocadas por nuestros propios elementos
                    const external = mutations.some(m =>
                        ![...m.addedNodes, ...m.removedNodes].every(n =>
                            n.nodeType === 1 && (
                                n.classList?.contains('price-chart-container') ||
                                n.classList?.contains('bpt-badge-row') ||
                                n.id === 'bpt-summary'
                            )
                        )
                    );
                    if (external) debouncedProcessing();
                });
                observer.observe(container, { childList: true, subtree: false });
            } else if (attempts >= 30) {
                clearInterval(checkInterval);
                checkInterval = null;
                log('Lista de deseos no encontrada tras 30 intentos');
            }
        }, 1000);
    }

    function onNavigate() {
        if (window.location.hash.includes('lista-deseos')) {
            createdCharts.forEach((_, id) => destroyExistingChart(id));
            setTimeout(waitForWishlist, 800);
        }
    }

    // ─────────────────────────────────────────────
    // Página de cada libro (detalle del producto)
    // ─────────────────────────────────────────────
    const DETAIL_CHART_ID = 'bpt-detail-book'; // clave en createdCharts

    function injectDetailStyles() {
        if (document.getElementById('bpt-detail-styles')) return;
        const style = document.createElement('style');
        style.id = 'bpt-detail-styles';
        style.textContent = `
            #bpt-detail-card {
                clear: both;
                margin: 20px 0 40px;
                padding: 16px 18px;
                background: #fff;
                border: 1px solid #ecebeb;
                border-radius: 10px;
                box-shadow: 0 1px 4px rgba(0,0,0,0.05);
                color: #333;
                box-sizing: border-box;
            }
            #bpt-detail-card * { box-sizing: border-box; }
            #bpt-detail-card .bpt-detail-head {
                display: flex;
                align-items: baseline;
                gap: 12px;
                flex-wrap: wrap;
                border-bottom: 1px solid #f0f0f0;
                padding-bottom: 10px;
                margin-bottom: 10px;
            }
            #bpt-detail-card .bpt-detail-title { font-size: 16px; font-weight: 600; color: #222; }
            #bpt-detail-card .bpt-detail-sub { font-size: 12px; color: #ff5a00; font-weight: 500; }
            #bpt-detail-card .bpt-detail-badges:empty { display: none; }
            #bpt-detail-card .bpt-detail-badges { margin-bottom: 8px; }
            #bpt-detail-card .bpt-detail-stats { font-size: 12px; line-height: 1.9; margin-bottom: 12px; }
            #bpt-detail-card .bpt-detail-canvas-wrap { position: relative; width: 100%; height: 220px; }
            #bpt-detail-card .bpt-detail-canvas-wrap canvas { width: 100% !important; height: 100% !important; }
            #bpt-detail-card .bpt-detail-note { font-size: 12px; color: #888; margin-top: 10px; }
            @media (max-width: 800px) {
                #bpt-detail-card .bpt-detail-canvas-wrap { height: 180px; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function getDetailBookId() {
        const m = window.location.pathname.match(/\/p\/(\d+)/);
        if (m) return m[1];
        const meta = document.querySelector('meta[itemprop="productID"]');
        return meta ? meta.getAttribute('content') : null;
    }

    // El precio visible del libro. La página nueva lo muestra dentro de la
    // opción seleccionada; dejamos varios respaldos por si cambia el DOM.
    function getDetailPrice() {
        const selectors = [
            '.opcionPrecio.selected .colPrecio .ped',
            '.opcionForm .precio',
            'section#producto p.precioAhora',
            '.opcionPrecio .ped',
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) {
                const p = parsePrice(el.textContent);
                if (p !== null) return p;
            }
        }
        return null;
    }

    function getDetailTitle() {
        const el = document.querySelector('.tituloProducto');
        if (el && el.textContent.trim()) return el.textContent.trim();
        const meta = document.querySelector('meta[name="title"]');
        return meta ? meta.getAttribute('content') : null;
    }

    function isDetailUnavailable() {
        // Sin botón de compra o con leyenda "agotado / no disponible" cerca
        // del bloque de precio ⇒ el precio mostrado no es confiable.
        const hasBuy = !!document.querySelector('#addToCart, .box-comprar button, form[action="/carro/agregar"] button');
        const priceBox = document.querySelector('#detallePrecio');
        if (priceBox && /agotado|no\s+disponible/i.test(priceBox.textContent)) return true;
        return !hasBuy;
    }

    function highlightFromStats(stats) {
        if (!stats || stats.count < CONFIG.minEntriesForBadges) return null;
        if (stats.isAllTimeLow) return 'atl';
        if (stats.vsAvg <= -CONFIG.dropThreshold) return 'drop';
        return null;
    }

    function buildDetailCard(book, stats, highlight) {
        const card = document.createElement('div');
        card.id = 'bpt-detail-card';
        if (highlight === 'atl') {
            card.style.boxShadow = `inset 5px 0 0 ${COLORS.low}, 0 1px 4px rgba(0,0,0,0.05)`;
        } else if (highlight === 'drop') {
            card.style.boxShadow = `inset 5px 0 0 ${COLORS.drop}, 0 1px 4px rgba(0,0,0,0.05)`;
        }

        const head = document.createElement('div');
        head.className = 'bpt-detail-head';
        head.innerHTML =
            '<span class="bpt-detail-title">📈 Historial de precios</span>' +
            '<span class="bpt-detail-sub">Rastreado desde tu lista de deseos</span>';
        card.appendChild(head);

        // Insignias (mínimo histórico / bajada fuerte)
        const badges = document.createElement('div');
        badges.className = 'bpt-detail-badges';
        if (stats && stats.count >= CONFIG.minEntriesForBadges) {
            if (stats.isAllTimeLow) badges.appendChild(makeBadge('★ Mínimo histórico', COLORS.low));
            if (stats.vsAvg <= -CONFIG.dropThreshold && !stats.isAllTimeLow) {
                const pct = Math.round(Math.abs(stats.vsAvg) * 100);
                badges.appendChild(makeBadge(`▼ ${pct}% bajo el promedio`, COLORS.drop));
            }
        }
        card.appendChild(badges);

        // Fila de estadísticas
        if (stats) {
            const statsDiv = document.createElement('div');
            statsDiv.className = 'bpt-detail-stats';
            const trendColor = stats.vsFirst < 0 ? COLORS.low : (stats.vsFirst > 0 ? COLORS.pointMax : '#444');
            const trendArrow = stats.vsFirst < 0 ? '▼' : (stats.vsFirst > 0 ? '▲' : '—');
            statsDiv.innerHTML =
                statChip('Actual:', formatPrice(stats.current), stats.isAllTimeLow ? COLORS.low : '#222') +
                statChip('Mín:', formatPrice(stats.min), COLORS.pointMin) +
                statChip('Máx:', formatPrice(stats.max), COLORS.pointMax) +
                statChip('Promedio:', formatPrice(stats.avg)) +
                statChip('Tendencia:', `${trendArrow} ${Math.abs(Math.round(stats.vsFirst * 100))}%`, trendColor);
            card.appendChild(statsDiv);
        }

        const entries = book.prices || [];
        if (entries.length >= 2) {
            const wrap = document.createElement('div');
            wrap.className = 'bpt-detail-canvas-wrap';
            const canvas = document.createElement('canvas');
            canvas.id = 'bpt-detail-canvas';
            wrap.appendChild(canvas);
            card.appendChild(wrap);
        }

        // Nota al pie: cuántos registros llevamos y desde cuándo
        const note = document.createElement('div');
        note.className = 'bpt-detail-note';
        if (entries.length >= 2) {
            const first = entries[0].date;
            const desde = new Date(first + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
            note.textContent = `${entries.length} registros · rastreando desde el ${desde}`;
        } else {
            note.textContent = 'Aún estamos reuniendo datos de este libro. Abre tu lista de deseos de vez en cuando para sumar más puntos al historial.';
        }
        card.appendChild(note);

        return card;
    }

    function renderBookDetailChart() {
        const bookId = getDetailBookId();
        if (!bookId) return;

        const history = getPriceHistory();
        const book = history[bookId];
        // Sólo mostramos libros que ya rastreamos desde la lista de deseos
        if (!book) return;

        // Registramos/actualizamos el precio de hoy con lo que muestra la
        // página del libro, para que el historial también avance al navegar.
        const price = getDetailPrice();
        if (price !== null) {
            const unavailable = isDetailUnavailable();
            const title = getDetailTitle();
            if (title) book.title = title;
            book.lastSeen = todayStr();
            book.prices = book.prices || [];
            const todayEntry = book.prices.find(p => p.date === todayStr());
            if (!todayEntry) {
                book.prices.push({ date: todayStr(), price, available: !unavailable });
            } else {
                todayEntry.price = price;
                todayEntry.available = !unavailable;
            }
            book.prices.sort((a, b) => a.date.localeCompare(b.date));
            savePriceHistory(history);
        }

        const stats = computeStats(book.prices || []);
        const highlight = highlightFromStats(stats);

        // Anclamos la tarjeta justo debajo del bloque del producto (estilo
        // Keepa), un lugar visible pero que no estorba la compra.
        const anchor = document.querySelector('#producto .product-info') || document.querySelector('#producto');
        if (!anchor) return;

        const previous = document.getElementById('bpt-detail-card');
        if (previous) previous.remove();
        destroyExistingChart(DETAIL_CHART_ID);

        const card = buildDetailCard(book, stats, highlight);
        anchor.insertAdjacentElement('afterend', card);

        // Dibujamos la gráfica si hay al menos 2 registros
        if ((book.prices || []).length >= 2) {
            const canvas = card.querySelector('#bpt-detail-canvas');
            const lineColor = highlight === 'atl' ? COLORS.low : COLORS.line;
            const fillColor = highlight === 'atl' ? 'rgba(26, 122, 76, 0.15)' : COLORS.fill;
            setTimeout(() => {
                try {
                    destroyExistingChart(DETAIL_CHART_ID);
                    const chart = buildLineChart(canvas, book.prices, lineColor, fillColor);
                    createdCharts.set(DETAIL_CHART_ID, chart);
                } catch (error) {
                    console.error('[PriceTracker] Error creando gráfica del libro:', error);
                }
            }, 150);
        }
    }

    function initDetailPage() {
        injectDetailStyles();
        const run = () => {
            try { renderBookDetailChart(); }
            catch (e) { console.error('[PriceTracker]', e); }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }

    // ─────────────────────────────────────────────
    // Página de instalación (GitHub Pages)
    // ─────────────────────────────────────────────
    // Le avisamos a la landing que el script ya está instalado y con qué
    // versión. Marcamos el DOM en vez de usar window.*: con @grant el
    // gestor corre el script en un sandbox cuyo window NO es el de la
    // página, pero el DOM sí es compartido.
    function announceInstallation() {
        // GM_info siempre está disponible y trae la versión del encabezado,
        // así no duplicamos el número de versión en el código.
        const version = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'desconocida';

        const mark = () => {
            const root = document.documentElement;
            if (!root) return;
            root.setAttribute('data-bpt-installed', version);
            root.dispatchEvent(new CustomEvent('bpt:installed'));
        };

        mark();
        // Si corrimos antes de que la landing enganchara su listener, el
        // atributo ya quedó puesto y la página lo detecta por sondeo.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mark);
        }
        log('Anunciada la instalación a la landing, versión', version);
    }

    // ─────────────────────────────────────────────
    // Arranque: elegimos el modo según la página
    // ─────────────────────────────────────────────
    if (window.location.hostname.endsWith('github.io')) {
        announceInstallation();
        return; // la landing no necesita nada más
    }

    injectStyles();

    const isDetailPage = /\/p\/\d+/.test(window.location.pathname);
    const isDashboard = window.location.pathname.includes('/v2/u/dashboard');

    if (isDetailPage && !isDashboard) {
        initDetailPage();
    } else {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', waitForWishlist);
        } else {
            waitForWishlist();
        }
        window.addEventListener('hashchange', onNavigate);
    }

    window.addEventListener('beforeunload', () => {
        createdCharts.forEach((_, id) => destroyExistingChart(id));
    });
})();

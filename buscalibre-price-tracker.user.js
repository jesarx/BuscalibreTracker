// ==UserScript==
// @name         Buscalibre Wishlist Price Tracker
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Rastrea el historial de precios de tu lista de deseos en Buscalibre, con alertas visuales de bajadas y mínimos históricos
// @author       Eduardo
// @match        https://www.buscalibre.com.mx/v2/u/dashboard*
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

        const entries = bookHistory.prices;
        const labels = entries.map(p => new Date(p.date + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));
        const prices = entries.map(p => p.price);

        // Colores de línea y relleno según el estado del libro
        const lineColor = unavailable ? COLORS.pointGray
            : highlight === 'atl' ? COLORS.low
            : COLORS.line;
        const fillColor = unavailable ? 'rgba(160, 160, 160, 0.12)'
            : highlight === 'atl' ? 'rgba(26, 122, 76, 0.15)'
            : COLORS.fill;

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

        setTimeout(() => {
            try {
                destroyExistingChart(bookId);
                const ctx = canvas.getContext('2d');
                const chart = new Chart(ctx, {
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
                createdCharts.set(bookId, chart);
            } catch (error) {
                console.error(`[PriceTracker] Error creando gráfica para ${bookId}:`, error);
                container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">No se pudo cargar la gráfica</div>';
            }
        }, 150);

        return container;
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
        `;

        panel.querySelector('#bpt-export').addEventListener('click', exportHistory);
        panel.querySelector('#bpt-import').addEventListener('click', importHistory);

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

        bookItems.forEach((item) => {
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

    injectStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForWishlist);
    } else {
        waitForWishlist();
    }
    window.addEventListener('hashchange', onNavigate);

    window.addEventListener('beforeunload', () => {
        createdCharts.forEach((_, id) => destroyExistingChart(id));
    });
})();

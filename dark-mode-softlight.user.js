// ==UserScript==
// @name         暗黑模式 · 大面积文案柔光降白
// @namespace    https://your-namespace.example.com
// @version      2.1.1
// @description  压暗大面积正文，支持按网站独立调节亮度，严格保护交互/高亮/代码/黑幕/透明文字
// @author       Raynon
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/588400/%E6%9A%97%E9%BB%91%E6%A8%A1%E5%BC%8F%20%C2%B7%20%E5%A4%A7%E9%9D%A2%E7%A7%AF%E6%96%87%E6%A1%88%E6%9F%94%E5%85%89%E9%99%8D%E7%99%BD.user.js
// @updateURL https://update.greasyfork.org/scripts/588400/%E6%9A%97%E9%BB%91%E6%A8%A1%E5%BC%8F%20%C2%B7%20%E5%A4%A7%E9%9D%A2%E7%A7%AF%E6%96%87%E6%A1%88%E6%9F%94%E5%85%89%E9%99%8D%E7%99%BD.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const DEFAULT_BRIGHTNESS = 80;
    const host = location.hostname;
    const PENDING_KEY = '__gm_pending_hosts__';
    const EXCLUDED_KEY = '__gm_excluded_pages__';
    const OVERLAY_ID = 'gm-lightness-overlay';

    function getPageKey() { return location.origin + location.pathname; }

    // ===== 存储 =====
    function getStorageKey(h) { return 'lightness_' + h; }
    function getBrightnessForSite(h) { return GM_getValue(getStorageKey(h), DEFAULT_BRIGHTNESS); }
    function setBrightnessForSite(h, val) { GM_setValue(getStorageKey(h), val); }

    // ===== 亮度控制 =====
    const TEXT_SELECTOR = [
        'body', 'div', 'p', 'span', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'td', 'th', 'label', 'strong', 'figcaption', 'blockquote',
        'dt', 'dd', 'article', 'section', 'main', 'aside'
    ].join(',');

    const EXCLUDE = [
        'a', 'a *',
        'button', 'button *',
        'input', 'input *',
        'textarea', 'textarea *',
        'em', 'em *',
        'code', 'code *',
        '.heimu', '.heimu *',
        '[style*="transparent"]', '[style*="transparent"] *',
        '#gm-lightness-overlay', '#gm-lightness-overlay *'
    ];
    const EXCLUDE_SELECTOR = EXCLUDE.join(', ');

    function apply() {
        document.querySelector('#gm-style-softlight')?.remove();
        if (GM_getValue(EXCLUDED_KEY, []).includes(getPageKey())) return;
        const percent = getBrightnessForSite(host);
        const style = document.createElement('style');
        style.id = 'gm-style-softlight';
        style.textContent = `
            @media (prefers-color-scheme: dark) {
                :root { color: hsl(0, 0%, ${percent}%) !important; }
                :is(${TEXT_SELECTOR}):not(:is(${EXCLUDE_SELECTOR})) {
                    color: hsl(0, 0%, ${percent}%) !important;
                }
            }
        `;
        (document.documentElement || document.head).appendChild(style);
    }
    apply();

    // ===== 亮度调整浮层 =====
    function showOverlay() {
        if (document.getElementById(OVERLAY_ID)) return;
        const pending = GM_getValue(PENDING_KEY, []);
        if (!pending.length) return;
        GM_setValue(PENDING_KEY, []);

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#2a2a2a;color:#ddd;border-radius:12px;padding:20px 24px;min-width:340px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.6);';

        const title = document.createElement('div');
        title.textContent = '🌙 文字亮度调整';
        title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:16px;text-align:center;';
        panel.appendChild(title);

        const inputs = [];
        pending.forEach(h => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

            const label = document.createElement('span');
            label.textContent = h.length > 28 ? h.slice(0, 25) + '...' : h;
            label.title = h;
            label.style.cssText = 'flex:1;font-size:13px;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            const input = document.createElement('input');
            input.type = 'number';
            input.min = '10';
            input.max = '100';
            input.value = getBrightnessForSite(h);
            input.dataset.host = h;
            input.style.cssText = 'width:70px;padding:4px 8px;background:#1a1a1a;color:#ddd;border:1px solid #444;border-radius:4px;font-size:13px;text-align:center;box-sizing:border-box;';

            row.appendChild(label);
            row.appendChild(input);
            panel.appendChild(row);
            inputs.push(input);
        });

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:10px;margin-top:16px;';

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确认';
        confirmBtn.style.cssText = 'flex:1;padding:8px 16px;background:#4a7dd4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = 'flex:1;padding:8px 16px;background:#444;color:#ddd;border:none;border-radius:6px;cursor:pointer;font-size:14px;';

        actions.appendChild(confirmBtn);
        actions.appendChild(cancelBtn);
        panel.appendChild(actions);
        overlay.appendChild(panel);
        (document.body || document.documentElement).appendChild(overlay);

        confirmBtn.onclick = () => {
            inputs.forEach(inp => {
                const val = parseFloat(inp.value);
                if (!isNaN(val) && val >= 10 && val <= 100) {
                    setBrightnessForSite(inp.dataset.host, val);
                }
            });
            overlay.remove();
            apply();
        };

        cancelBtn.onclick = () => overlay.remove();
    }

    // ===== 菜单：亮度调整 =====
    GM_registerMenuCommand('🔆 全站文字亮度', () => {
        const pending = GM_getValue(PENDING_KEY, []);
        if (!pending.includes(host)) {
            pending.push(host);
            GM_setValue(PENDING_KEY, pending);
        }
        if (window.top === window.self) {
            setTimeout(showOverlay, 800);
        }
    });

    // ===== 菜单：本页压暗开关 =====
    GM_registerMenuCommand('🚫 本页压暗开关', () => {
        const list = GM_getValue(EXCLUDED_KEY, []);
        const key = getPageKey();
        const idx = list.indexOf(key);
        if (idx === -1) {
            list.push(key);
            GM_setValue(EXCLUDED_KEY, list);
        } else {
            list.splice(idx, 1);
            GM_setValue(EXCLUDED_KEY, list);
        }
        apply();
    });
})();

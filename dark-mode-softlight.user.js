// ==UserScript==
// @name         暗黑模式 · 大面积文案柔光降白
// @namespace    https://greasyfork.org/scripts/588400
// @version      2.4.1
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
    const TOAST_ID = 'gm-softlight-toast';

    function getPageKey() { return location.origin + location.pathname; }

    // ===== 存储 =====
    function getStorageKey(h) { return 'lightness_' + h; }
    function getBrightnessForSite(h) {
        const v = parseFloat(GM_getValue(getStorageKey(h), DEFAULT_BRIGHTNESS));
        return Number.isFinite(v) ? Math.min(100, Math.max(10, v)) : DEFAULT_BRIGHTNESS;
    }
    function setBrightnessForSite(h, val) { GM_setValue(getStorageKey(h), val); }

    // 会被压暗的正文容器（标题也在内 —— 站点自己声明过颜色的标题会被 :where() 让给站点）
    const TEXT_SELECTOR = [
        'body', 'div', 'p', 'span', 'li',
        'td', 'strong', 'blockquote', 'dd',
        'article', 'section', 'main', 'aside',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ].join(',');

    // 排除列表：一律不碰（⚠️ 排除不是保护罩 —— 靠继承取色的元素仍会被压灰）
    const EXCLUDE_TAGS = [
        // 交互 / 语义
        'a', 'button', 'input', 'textarea', 'select', 'option', 'optgroup',
        'em', 'code', 'label', 'summary', 'legend', 'fieldset', 'kbd', 'mark',
        // 标签型：短、常带站点配色
        'th', 'dt', 'figcaption', 'nav',
        '.heimu', '[style*="transparent"]', '#' + OVERLAY_ID, '#' + TOAST_ID
    ];
    // 代码 / 编辑器：保住语法高亮
    const EXCLUDE_CODE = [
        'pre', '[contenteditable]', '[class*="editor" i]', '[class*="mirror" i]',
        '[class*="hljs" i]', '[class*="shiki" i]'
    ];
    // div/span 写的 UI（导航、标签页、菜单…）用 role 认，比猜类名可靠
    const EXCLUDE_ROLES = [
        'navigation', 'tablist', 'tab', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
        'menuitemradio', 'toolbar', 'tooltip', 'alert', 'status', 'button', 'link',
        'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'textbox', 'searchbox',
        'slider', 'spinbutton', 'progressbar', 'meter', 'banner', 'contentinfo', 'log', 'timer'
    ];
    // 内联 color：连直接子元素一起护（数值常包在子 span 里）；不用整棵子树，否则外层一个内联色就整页漏压
    const EXCLUDE_INLINE = ['[style^="color:" i]', '[style*=" color:" i]', '[style*=";color:" i]'];
    // 关键词兜底：按"词的完整边界"匹配（词首与词尾都必须是分隔符或属性两端）
    //   只做词首会误命中：reduced→red、hotel→hot、warranty→warn、bluetooth→blue、tagline→tag、linkage→link
    const COLOR_WORDS = [
        'red', 'orange', 'amber', 'yellow', 'gold', 'pink', 'rose', 'crimson',
        'purple', 'violet', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'green',
        'emerald', 'lime', 'brown',
        'danger', 'warning', 'warn', 'error', 'hot'
    ];
    const NAME_WORDS = ['link', 'breadcrumb'];            // 链接 / 面包屑：连子树
    const CHIP_WORDS = ['tag', 'badge'];                  // 标签、角标：只护自己 + 直接子元素

    // 7 种"完整词"形状：空格分隔的独立词（class~=，覆盖 "btn red"）/ 词+分隔符开头 / 分隔符+词结尾 / 两侧被分隔符夹住
    //   一律不做无边界子串：那会把 hundred / bored / credit 也当成 red（2.1.4 之前的老毛病）
    const wordSelector = w => [
        `[class~="${w}" i]`,
        `[class^="${w}-" i]`, `[class^="${w}_" i]`,
        `[class$="-${w}" i]`, `[class$="_${w}" i]`,
        `[class*="-${w}-" i]`, `[class*="_${w}_" i]`
    ];
    const EXCLUDE = [];
    EXCLUDE_TAGS.concat(EXCLUDE_CODE).forEach(s => EXCLUDE.push(s, s + ' *'));
    const ROLE_SELECTOR = ':is(' + EXCLUDE_ROLES.map(r => `[role="${r}"]`).join(',') + ')';
    EXCLUDE.push(ROLE_SELECTOR, ROLE_SELECTOR + ' *');
    EXCLUDE_INLINE.forEach(s => EXCLUDE.push(s, s + ' > *'));
    CHIP_WORDS.forEach(w => wordSelector(w).forEach(s => EXCLUDE.push(s, s + ' > *')));
    // 颜色/语义词：只护自己 + 直接子元素（连整棵子树时，祖先偶然含颜色词就会吃掉一整块内容：Gemini 的 reduced-* 就是这么来的）
    COLOR_WORDS.forEach(w => wordSelector(w).forEach(s => EXCLUDE.push(s, s + ' > *')));
    NAME_WORDS.forEach(w => wordSelector(w).forEach(s => EXCLUDE.push(s, s + ' *')));      // 链接 / 面包屑：连子树
    const EXCLUDE_SELECTOR = EXCLUDE.join(', ');

    // ===== 2.3.0 亮白判据（低成本变体）：站点把"标题"声明成亮白时也压一档 =====
    // 只扫标题类、只在 DOMContentLoaded / load 各跑一次、不装监听器（稳态开销 0）
    const HARD_CLASS = 'gm-softlight-hard';
    const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"],[class*="title" i],[class*="heading" i],[class*="headline" i]';
    const HARD_MAX = 200;
    // 与 EXCLUDE 同源，只去掉"内联 color"那一组：内联亮白的标题也该压（内联彩色的会被亮度判定放过）
    const SWEEP_SKIP = EXCLUDE.filter(s => !/\[style[^\]]*color/i.test(s));
    const SWEEP_SKIP_SELECTOR = SWEEP_SKIP.join(', ');

    // 又亮又几乎没色调才算刺眼：≥0.90 容忍一点色偏；0.70–0.90 要求纯中性（0.70 = 目标灰 0.60 再留一档）
    function isGlaring(css) {
        const m = /(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/.exec(css || '');
        if (!m) return false;
        const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const L = 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
        const chroma = Math.max(+m[1], +m[2], +m[3]) - Math.min(+m[1], +m[2], +m[3]);
        return (L >= 0.9 && chroma <= 40) || (L >= 0.7 && chroma <= 24);
    }
    function clearHard() {
        document.querySelectorAll('.' + HARD_CLASS).forEach(el => el.classList.remove(HARD_CLASS));
    }
    function sweepHeadings() {
        if (isOff()) return;
        try {
            const list = document.querySelectorAll(HEADING_SELECTOR);
            for (let i = 0; i < list.length && i < HARD_MAX; i++) {
                const el = list[i];
                if (el.classList.contains(HARD_CLASS)) el.classList.remove(HARD_CLASS);   // 先摘掉自己上次加的
                if (isGlaring(getComputedStyle(el).color) && !el.matches(SWEEP_SKIP_SELECTOR)) el.classList.add(HARD_CLASS);
            }
        } catch (e) { /* 出问题就退回纯 CSS，不影响基础压暗 */ }
    }

    // ===== 跨 frame 同步：子 frame 的页面键与主页面不同，状态由顶层广播 =====
    const SYNC_MSG = 'gm-softlight-sync';
    let topOff = null;                      // 由顶层广播而来：true = 主页面已关闭压暗

    function pushToChildren(off) {
        for (let i = 0; i < window.frames.length; i++) {
            try { window.frames[i].postMessage({ t: SYNC_MSG, off: off }, '*'); } catch (e) {}
        }
    }

    function isOff() {
        if (topOff === true) return true;   // 顶层说关，就跟着关
        return GM_getValue(EXCLUDED_KEY, []).includes(getPageKey());
    }

    window.addEventListener('message', e => {
        if (!e.data || e.data.t !== SYNC_MSG) return;
        if (e.source !== window.parent) return;   // 只认父 frame 的广播（顶层 parent 即自己）：第三方 iframe 不能关掉本层压暗
        topOff = !!e.data.off;
        apply();                            // apply() 里会把同一个状态继续传给更深的 frame
    });

    // 不用 !important + :where() 降到最低优先级：站点自己声明过颜色的元素一律让它赢
    function apply() {
        document.querySelector('#gm-style-softlight')?.remove();
        const off = isOff();
        if (window.top === window.self) pushToChildren(off);      // 顶层：广播自己的决定
        else if (topOff !== null) pushToChildren(topOff);         // 子 frame：把顶层的决定往下传
        if (off) { clearHard(); return; }
        const percent = getBrightnessForSite(host);
        const style = document.createElement('style');
        style.id = 'gm-style-softlight';
        style.textContent = `
            @media (prefers-color-scheme: dark) {
                :where(:root) { color: hsl(0, 0%, ${percent}%); }
                :where(${TEXT_SELECTOR}):not(:where(${EXCLUDE_SELECTOR})) {
                    color: hsl(0, 0%, ${percent}%);
                }
                body .${HARD_CLASS} { color: hsl(0, 0%, ${percent}%) !important; }
            }
        `;
        (document.documentElement || document.head).appendChild(style);
        sweepHeadings();
    }
    apply();
    // 子 frame 可能是初始化之后才建的：load 时补发一次
    if (window.top === window.self) window.addEventListener('load', () => pushToChildren(isOff()));
    window.addEventListener('DOMContentLoaded', sweepHeadings);
    window.addEventListener('load', sweepHeadings);

    // ===== 状态提示（1.8 秒后自动消失）=====
    function toast(text) {
        document.getElementById(TOAST_ID)?.remove();
        const el = document.createElement('div');
        el.id = TOAST_ID;
        el.textContent = text;
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(28,28,28,.95);color:#eee;' +
            'font:13px/1.5 system-ui,-apple-system,sans-serif;padding:8px 12px;border-radius:8px;' +
            'box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:none;transition:opacity .4s;';
        (document.body || document.documentElement).appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 1800);
    }

    // ===== 亮度调整浮层 =====
    function showOverlay() {
        if (document.getElementById(OVERLAY_ID)) return;
        const pending = GM_getValue(PENDING_KEY, []).slice();   // 快照：这次要显示的 host
        if (!pending.length) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#2a2a2a;color:#ddd;border-radius:12px;padding:20px 24px;min-width:340px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.6);';

        const title = document.createElement('div');
        title.textContent = '🌙 文字亮度调整';
        title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:16px;text-align:center;';
        panel.appendChild(title);

        if (isOff()) {
            const warn = document.createElement('div');
            warn.textContent = '⚠️ 本页当前已关闭压暗：这里改的值会存下来，但要先用 🚫 菜单重新开启才会生效';
            warn.style.cssText = 'font-size:12px;line-height:1.5;color:#f0c674;background:#3a2f10;border-radius:6px;padding:6px 8px;margin-bottom:12px;';
            panel.appendChild(warn);
        }

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

        // 只移除"这次真的显示出来"的 host：渲染失败不丢输入，渲染期间迟到登记留到下次
        const shown = new Set(pending);
        GM_setValue(PENDING_KEY, GM_getValue(PENDING_KEY, []).filter(h => !shown.has(h)));

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
        // 只由顶层处理：菜单点击会送到每个 frame，抢写存储会互相覆盖
        if (window.top !== window.self) return;
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
        toast(idx === -1 ? '🚫 本页已关闭压暗（再点一次可恢复）' : '✅ 本页已恢复压暗');
    });
})();

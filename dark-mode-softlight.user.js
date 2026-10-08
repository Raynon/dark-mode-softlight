// ==UserScript==
// @name         暗黑模式 · 大面积文案柔光降白
// @namespace    https://greasyfork.org/scripts/588400
// @version      2.1.5
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

    // ===== 亮度控制 =====
    // 只压"大面积正文容器"。h1–h6 刻意不在列表里：标题是小面积、带层级与站点配色的东西，
    // 压它会抹掉颜色（2026-10-06 作者决定 T1）—— 判据见 AGENTS.md 顶部"唯一目标"。
    const TEXT_SELECTOR = [
        'body', 'div', 'p', 'span', 'li',
        'td', 'th', 'label', 'strong', 'figcaption', 'blockquote',
        'dt', 'dd', 'article', 'section', 'main', 'aside'
    ].join(',');

    // ===== 排除列表：这些一律不碰 =====
    // ⚠️ 排除只是"我们不给它设颜色"，不是保护罩：元素自己没有颜色声明时，仍会继承祖先的颜色 ——
    // 所以"靠继承取色"的东西，排除救不了（详见 AGENTS.md 的 A3）。
    const EXCLUDE_BASE = [
        'a', 'button', 'input', 'textarea', 'em', 'code',
        '.heimu', '[style*="transparent"]', '#' + OVERLAY_ID, '#' + TOAST_ID
    ];
    // 代码 / 编辑器：保住语法高亮。token 一般自带主题色，把容器整棵子树排除即可恢复。
    const EXCLUDE_CODE = [
        'pre', '[contenteditable]',
        '[class*="editor" i]',   // Monaco（.monaco-editor）/ CodeMirror 6（.cm-editor）/ Ace（.ace_editor）
        '[class*="mirror" i]',   // CodeMirror 5（.CodeMirror）
        '[class*="hljs" i]',     // highlight.js
        '[class*="shiki" i]'     // Shiki
    ];
    // 强调色：保住站点给的冷暖颜色（颜色词全包）。
    // 语义词只留警示类 —— success / info / primary 常被当主题或布局类名用，命中会把大片区域一起放过。
    const COLOR_WORDS = [
        'red', 'orange', 'amber', 'yellow', 'gold', 'pink', 'rose', 'crimson',
        'purple', 'violet', 'indigo', 'blue', 'sky', 'cyan', 'teal', 'green',
        'emerald', 'lime', 'brown',
        'danger', 'warning', 'warn', 'error', 'hot'
    ];
    // 标题型类名：站点常用 class 而不是 h1–h6 标签来做标题。
    // 实测 agedm 的「在线播放」标题就是 <div class="title"> 里的 <span>（红字来自 CSS，不带颜色词），
    // 只把 h1–h6 移出白名单修不到它 —— 见 AGENTS.md 的 T1 说明。
    const TITLE_WORDS = ['title'];
    // 链接型类名：站点也常用 class 而不是 <a> 来做链接。
    // 实测 scriptcat 面包屑的「当前页名」就是 <span class="ant-breadcrumb-link">（蓝灰来自
    // --ant-breadcrumb-last-item-color）—— 链接按既定策略一律保持原样，所以这类元素也要放过。
    const LINK_WORDS = ['link'];
    // 站点用**内联样式**上的强调色（内联没有 !important）会被我们的 !important 压掉 —— 这是实测踩到的**误压**：
    // scriptcat 介绍页右侧「数据统计」的三个数字（1.9K 蓝 #1890ff、+14 绿 #52c41a、5.0 橙 #faad14）
    // 全靠 <div class="ant-statistic-content" style="color:#1890ff;…">，被我们统一抹成 80% 灰。
    // 这里用**结构**识别（不靠猜名字）：`color:` 出现在开头 / 空格后 / 分号后三种写法都算。
    // ⚠️ 只护「它自己 + 直接子元素」（` > *`）：值常常包在直接子 <span> 里（antd 就是这样），
    //    若用整棵子树（` *`），站点在外层随便写一个内联色就会让整页漏压。
    // ⚠️ 不会误命中 background-color / border-color（"color" 前面是 `-`，不是空格或分号）。
    const EXCLUDE_INLINE = ['[style^="color:" i]', '[style*=" color:" i]', '[style*=";color:" i]'];
    // 关键词必须按"词的边界"匹配，不能子串匹配（2.1.3 的教训，2026-10-09 实测）：
    //   [class*="red" i]  会命中 bordered（borde·red）
    //   [class*="rose" i] 会命中 prose（p·rose，Tailwind Typography）
    //   [class*="hot" i]  会命中 photo
    // 而这些词都带 ` *`（后代）变体 ⇒ 命中一次就把**整块内容**放过：scriptcat 介绍页整篇文章
    // 因此没被压暗（正文 54/48 字的 p/li 保持 rgb(240,246,252)），页面其它 100 个元素却正常变灰。
    // 所以每个词展开成 4 个"词首边界"模式，各带 own 与子树两种。
    const wordSelector = w => [
        `[class^="${w}" i]`,        // class="red" / "danger-btn"
        `[class*=" ${w}" i]`,       // class="btn danger"
        `[class*="-${w}" i]`,       // class="text-danger" / "bg-red-50" / "ant-tag-lime"
        `[class*="_${w}" i]`        // class="btn_danger"
    ];
    // 每组都连子树一起排除：后代若靠继承取色，只排除元素本身仍会被压灰
    const EXCLUDE = [];
    EXCLUDE_BASE.concat(EXCLUDE_CODE).forEach(s => EXCLUDE.push(s, s + ' *'));
    EXCLUDE_INLINE.forEach(s => EXCLUDE.push(s, s + ' > *'));
    COLOR_WORDS.concat(TITLE_WORDS, LINK_WORDS).forEach(w => {
        wordSelector(w).forEach(s => EXCLUDE.push(s, s + ' *'));
    });
    const EXCLUDE_SELECTOR = EXCLUDE.join(', ');

    // ===== 跨 frame 同步（正文在 iframe 里的站点，例如淘宝首页）=====
    // 子 frame 的 getPageKey() 与主页面不同（key = origin + pathname），所以"本页是否关闭压暗"
    // 必须由顶层广播下去，子 frame 才会跟着关；改亮度同样要广播，子 frame 才会立刻重算。
    // （2.1.3 及以前：只有当前 frame 重跑 apply()，其余 frame 的样式不变，要刷新页面才生效。）
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
        topOff = !!e.data.off;
        apply();                            // apply() 里会把同一个状态继续传给更深的 frame
    });

    function apply() {
        document.querySelector('#gm-style-softlight')?.remove();
        const off = isOff();
        if (window.top === window.self) pushToChildren(off);      // 顶层：广播自己的决定
        else if (topOff !== null) pushToChildren(topOff);         // 子 frame：把顶层的决定往下传
        if (off) return;
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
    // 子 frame 可能是脚本初始化之后才创建的，所以顶层再在 load 时补发一次状态
    if (window.top === window.self) window.addEventListener('load', () => pushToChildren(isOff()));

    // ===== 一次性提示（用完即弃）=====
    // 用途：🚫 开关按下后告诉用户"现在是什么状态" —— 否则用户会以为脚本坏了（见 AGENTS.md 的 C7）
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

        // 队列清理放在"渲染成功之后"，且只移除这次真的显示出来的 host：
        // ① 渲染失败时输入不丢（下次点菜单还在）；② 渲染期间迟到登记的 host 仍留到下次（原有累积行为不变）
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
        // ⚠️ 只由顶层处理（2026-10-09 实测：淘宝首页有 3 个 frame，菜单点击会送到**每一个** frame，
        // 各 frame 同时"读-改-写"同一个存储键 ⇒ 互相覆盖：表现是**每次点都提示"已恢复压暗"、关不掉**；
        // 而且 frame 的 getPageKey() 也不是本页的 key）。
        // 顶层改完，由 apply() 里的广播把状态带给子 frame（这才是"关掉 frame 里的内容"的正确路径）。
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

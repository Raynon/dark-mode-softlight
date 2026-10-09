#!/usr/bin/env node
/**
 * 用例覆盖检查器（不依赖浏览器，给 agent / 命令行用）
 *
 *   node check-cases.js            # 检查 test-cases.html 里的全部用例
 *   node check-cases.js -v         # 同时打印通过的用例
 *   node check-cases.js --serve    # 先检查，再起本地静态服务（测试页必须用 http:// 打开）
 *
 * 它做三件事：
 *   1. 把 userscript 跑在沙箱里（GM_* 打桩），拿到它**真实注入的 CSS**；
 *   2. 解析 test-cases.html 里的每个 [data-expect] 元素（标签 / class / 内联 style / 祖先链）
 *      和页面自己的 <style>（哪条规则给它声明了 color）；
 *   3. 按脚本的规则 + 优先级模型（我们的规则是 (0,0,0)，站点任何声明都赢）判断
 *      "这个元素会被压暗还是保持原样"，与 data-expect 比对。
 *
 * ⚠️ 这是**静态校验**（选择器 + 优先级模型），不是浏览器渲染。
 *    真实渲染请在浏览器里打开 http://127.0.0.1:8799/test-cases.html 点「运行检查」。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const SCRIPT = path.join(DIR, 'dark-mode-softlight.user.js');
const PAGE = path.join(DIR, 'test-cases.html');
const VERBOSE = process.argv.includes('-v');

// ---------- 1. 拿到脚本真实注入的 CSS ----------
function injectedCss() {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const store = {};
    const injected = [];
    const mk = (tag) => ({
        tagName: String(tag).toUpperCase(), id: '', className: '', textContent: '', title: '', style: {}, dataset: {},
        children: [], appendChild(c) { this.children.push(c); return c; }, remove() { this.removed = true; },
    });
    const head = mk('head'), body = mk('body'), html = mk('html');
    html.children.push(head, body);
    const all = (n, out) => { out = out || []; if (!n) return out; out.push(n); for (const c of n.children || []) all(c, out); return out; };
    const styles = () => (html.children || []).filter((c) => c.tagName === 'STYLE' && !c.removed);
    html.appendChild = function (c) {
        this.children.push(c);
        if (String(c.tagName).toUpperCase() === 'STYLE') injected.push(String(c.textContent));
        return c;
    };
    const self = {};
    const document = {
        head, body, documentElement: html, createElement: mk,
        getElementById: (id) => all(html).find((n) => n.id === id && !n.removed) || null,
        querySelector: (s) => (s === '#gm-style-softlight' ? styles().slice(-1)[0] || null : null),
    };
    const sandbox = {
        document,
        location: { hostname: 'example.com', origin: 'https://example.com', pathname: '/p' },
        window: { top: self, self, frames: [], addEventListener() {} },
        setTimeout: (f) => f(),
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        GM_registerMenuCommand() {},
        console,
    };
    vm.runInContext(src, vm.createContext(sandbox));
    return injected.join('\n');
}

// ---------- 2. 极简选择器匹配（只覆盖脚本与测试页用到的形式）----------
function splitTop(s, sep) {           // 按顶层分隔符切分（跳过 () [] "" 内部）
    const out = []; let depth = 0, cur = '', quote = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if ('(['.includes(ch)) depth++;
        if (')]'.includes(ch)) depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
}

// 单个"复合选择器"（不含组合符）的匹配：tag / .class / #id / [attr] / [attr^="v" i] / :is(a,b)
function matchCompound(el, sel) {
    sel = sel.trim();
    const isGroups = [...sel.matchAll(/:is\(([^)]*)\)/g)].map((m) => m[1]);
    sel = sel.replace(/:is\([^)]*\)/g, '');
    const attrs = [...sel.matchAll(/\[\s*([\w-]+)\s*(?:([\^*$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*(i)?)?\s*\]/g)];
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const ids = [...sel.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
    const tags = sel.replace(/\[[^\]]*\]/g, '').replace(/[.#][\w-]+/g, '').replace(/\*/g, '').trim();

    if (tags && el.tag !== tags.toLowerCase()) return false;
    if (ids.length && !ids.every((id) => el.id === id)) return false;
    if (classes.length && !classes.every((c) => el.classes.includes(c))) return false;
    for (const m of attrs) {
        const name = m[1].toLowerCase(), op = m[2], val = (m[3] ?? m[4] ?? m[5] ?? '');
        const have = el.attrs[name];
        if (have === undefined) return false;
        if (!op) continue;
        const a = m[6] ? have.toLowerCase() : have, b = m[6] ? val.toLowerCase() : val;
        if (op === '=' && a !== b) return false;
        if (op === '^=' && !a.startsWith(b)) return false;
        if (op === '*=' && !a.includes(b)) return false;
        if (op === '$=' && !a.endsWith(b)) return false;
    }
    for (const g of isGroups) {
        if (!splitTop(g, ',').some((sub) => matchCompound(el, sub))) return false;
    }
    return true;
}

// 带组合符的选择器：a b（后代）/ a > b（子）/ 单复合
function matchSelector(el, sel) {
    sel = sel.trim();
    const parts = splitTop(sel, '>');
    if (parts.length === 2) {                       // 只支持一层 child 组合
        const [anc, child] = parts;
        return matchSelector(el, child) && el.parent && matchChain(el.parent, splitTop(anc, ' '));
    }
    const chain = splitTop(sel, ' ');
    return matchChain(el, chain);
}
function matchChain(el, chain) {
    if (!chain.length) return true;
    const last = chain[chain.length - 1];
    if (!matchCompound(el, last)) return false;
    if (chain.length === 1) return true;
    let p = el.parent;
    while (p) { if (matchChain(p, chain.slice(0, -1))) return true; p = p.parent; }
    return false;
}

// ---------- 3. 解析测试页 ----------
function parsePage(html) {
    // 3.1 页面自己的 CSS：先去掉注释（否则注释会被当成选择器的一部分，紧跟注释的那条规则就废了）
    const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');
    const pageRules = [];
    for (const m of styleBlocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/(^|;)\s*color\s*:/.test(m[2])) continue;
        const value = (/color\s*:\s*([^;]+)/.exec(m[2]) || [])[1];
        for (const sel of splitTop(m[1], ',')) pageRules.push({ sel: sel.replace(/::?[\w-]+(\([^)]*\))?/g, ''), value: (value || '').trim() });
    }
    // 3.2 用例元素（栈式遍历，记录祖先链）
    const body = html.slice(html.indexOf('<body'));
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const stack = []; const cases = []; let m;
    const makeEl = (tag, raw, parent) => {
        const attrs = {};
        for (const a of raw.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
            const nm = a[1].toLowerCase();
            if (attrs[nm] === undefined) attrs[nm] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
        }
        return {
            tag: tag.toLowerCase(),
            classes: (attrs.class || '').split(/\s+/).filter(Boolean),
            id: attrs.id || '',
            attrs,
            style: attrs.style || '',
            parent: parent || null,
        };
    };
    while ((m = re.exec(body)) !== null) {
        const close = m[1], open = m[2], raw = m[3] || '', text = m[5];
        if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].el.tag === close.toLowerCase()) { stack.length = i; break; } continue; }
        if (open) {
            const parent = stack.length ? stack[stack.length - 1].el : null;
            const el = makeEl(open, raw, parent);
            if (el.attrs['data-expect']) { el.text = ''; cases.push(el); }
            if (!VOID.has(el.tag) && m[4] !== '/') stack.push({ el });
            continue;
        }
        if (text && stack.length) {
            const top = stack[stack.length - 1].el;
            if (top && top.attrs && top.attrs['data-expect']) top.text += text;
        }
    }
    return { pageRules, cases };
}

// ---------- 4. 判定 ----------
// 2.3.0 亮白判据（与脚本里的 isGlaring / SWEEP_SELECTOR 保持一致；改脚本时这里要同步）
function parseColor(v) {
    if (!v) return null;
    const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(v);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
    return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;      // var(--x) 之类解析不了 ⇒ 当作不刺眼
}
function isGlaring(rgb) {
    if (!rgb) return false;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const chroma = Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
    return (L >= 0.9 && chroma <= 40) || (L >= 0.7 && chroma <= 24);
}
// 2.3.0 低成本变体：**只扫标题类**（与脚本里的 HEADING_SELECTOR 保持一致；改脚本时这里要同步）
const SWEEP_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
function sweepCandidate(el) {
    if (SWEEP_TAGS.has(el.tag)) return true;
    if ((el.attrs.role || '').toLowerCase() === 'heading') return true;
    return el.classes.some((c) => /title|heading|headline/i.test(c));
}
function hitExcludes(el, list) {
    return list.some((x) => {
        if (x.kind === 'self') return matchSelector(el, x.sel);
        if (x.kind === 'child') return (el.parent && matchSelector(el.parent, x.sel)) || matchSelector(el, x.sel);
        let p = el;                            // subtree：元素自身或任一祖先命中
        while (p) { if (matchSelector(p, x.sel)) return true; p = p.parent; }
        return false;
    });
}

function main(exitOnFail) {
    const css = injectedCss();
    const rule = /:where\(([^)]*)\):not\(:where\(([\s\S]*?)\)\)\s*\{/.exec(css);
    if (!rule) { console.error('✗ 没能从注入的 CSS 里解析出主规则'); process.exit(2); }
    const whitelist = splitTop(rule[1], ',');
    const excludes = splitTop(rule[2], ',').map((s) => {
        if (/\s>\s\*$/.test(s)) return { kind: 'child', sel: s.replace(/\s>\s\*$/, '') };
        if (/\s\*$/.test(s)) return { kind: 'subtree', sel: s.replace(/\s\*$/, '') };
        return { kind: 'self', sel: s };
    });
    const { pageRules, cases } = parsePage(fs.readFileSync(PAGE, 'utf8'));
    const hasHard = css.indexOf('.gm-softlight-hard') >= 0;            // 装的这份脚本有没有 2.3.0 判据
    // 补压时的跳过列表 = 全部排除项**去掉"内联 color"那一组**（内联亮白也该压）
    const sweepExcludes = excludes.filter((x) => !/\[style[^\]]*color/i.test(x.sel));

    let pass = 0, fail = 0, limit = 0, skipped = 0; const bad = [], notes = [];
    for (const el of cases) {
        const want = el.attrs['data-expect'];
        const inWhitelist = whitelist.includes(el.tag);
        const hitExclude = hitExcludes(el, excludes);
        const dimmed = inWhitelist && !hitExclude;
        const inlineColor = /(^|;)\s*color\s*:/.test(el.style);
        const declared = (inlineColor ? [el.style] : []).concat(
            pageRules.filter((r) => r.sel && matchSelector(el, r.sel)).map((r) => r.value));
        const pageColor = declared.length > 0;
        // 2.3.0：站点声明过颜色的元素，若声明值"又亮又几乎没色调"，会被补压（.gm-softlight-hard）
        const hard = hasHard && declared.some((v) => isGlaring(parseColor(v))) &&
            sweepCandidate(el) && !hitExcludes(el, sweepExcludes);
        // 基础规则的优先级是 (0,0,0)：站点只要在该元素上声明过颜色（内联/类名）就赢；补压那条是定向覆盖
        const actual = hard ? 'dimmed' : (!dimmed ? 'kept' : (pageColor ? 'kept' : 'dimmed'));
        const why = hard ? '站点声明的就是亮白 ⇒ 2.3.0 补压'
            : (!dimmed
                ? (!inWhitelist ? '不在压暗白名单' : '命中排除列表')
                : (pageColor ? '站点自己声明过颜色 ⇒ 让给站点' : '没有自己的颜色 ⇒ 被压暗'));
        const name = '<' + el.tag + (el.classes.length ? '.' + el.classes.join('.') : '') + '> ' +
            (el.text || '').trim().replace(/\s+/g, ' ').slice(0, 26);

        if (el.attrs['data-need'] && !hasHard) {
            skipped++;
            notes.push('⏭ [skip] ' + name + '（这一版脚本没有 2.3.0 亮白判据）');
            continue;
        }
        if (want === 'limit') {
            limit++;
            notes.push('ℹ️ [limit] ' + name + ' ⇒ ' + actual + '（' + why + '；已知限制，不计成败）');
            continue;
        }
        const ok = (want === 'dim' && actual === 'dimmed') || (want === 'keep' && actual === 'kept');
        if (ok) { pass++; if (VERBOSE) notes.push('✅ [' + want + '] ' + name + ' ⇒ ' + actual + '（' + why + '）' +
            '[dim=' + dimmed + ' page=' + pageColor + ' hard=' + hard + ' decl=' + declared.length + ']'); }
        else { fail++; bad.push('❌ [' + want + '] ' + name + ' ⇒ ' + actual + '（' + why + '）'); }
    }

    console.log('用例总数 ' + cases.length + '（其中已知限制 ' + limit + ' 条' +
        (skipped ? '，跳过 ' + skipped + ' 条：需要 2.3.0+' : '') + '）');
    console.log('通过 ' + pass + '　失败 ' + fail);
    if (bad.length) { console.log(''); bad.forEach((b) => console.log(b)); }
    if (notes.length && (VERBOSE || fail)) { console.log(''); notes.forEach((n) => console.log(n)); }
    console.log('');
    console.log(fail ? '✗ 有用例不符合预期' : '✓ 全部符合预期（静态校验：选择器 + 优先级模型）');
    if (fail && exitOnFail !== false) process.exit(1);
}
// ---------- 5. 入口 ----------
function serve() {
    const http = require('http');
    const PORT = Number(process.env.PORT || 8799);
    http.createServer((req, res) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]);
        const file = path.resolve(DIR, '.' + (rel.startsWith('/') ? rel : '/' + rel));
        if (file !== DIR && !file.startsWith(DIR + path.sep)) { res.writeHead(403); res.end('403'); return; }
        fs.readFile(file, (err, buf) => {
            if (err) { res.writeHead(404); res.end('404'); return; }
            const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
                : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
                : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type });
            res.end(buf);
        });
    }).listen(PORT, '127.0.0.1', () => {
        console.log('');
        console.log('测试页（记得浏览器/系统切深色模式）： http://127.0.0.1:' + PORT + '/test-cases.html');
        console.log('  · 装了脚本：直接点「运行检查」');
        console.log('  · 没装脚本：打开 ' + 'http://127.0.0.1:' + PORT + '/test-cases.html?auto=1' + ' —— 会自动抓脚本源码模拟跑一遍');
        console.log('  Ctrl+C 结束。');
    });
}

if (process.argv.includes('--serve')) { main(false); serve(); } else { main(true); }

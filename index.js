// 坐忘堂 · SillyTavern 原生扩展
// 在正文聊天之外提供议事面板：讨论用 generateQuietPrompt（不进聊天），
// 大纲写入当前激活世界书的 constant 条目，供写作类预设自动消费。
// 与任何预设解耦：不依赖预设内嵌脚本、不依赖 TavernHelper。
//
// UI：普通 AI 问答式（居中卡片 + 遮罩 + 白底对话流 + 底部输入框）。
// 注意：本服务器环境的 script.js 未导出 getContext/eventSource/event_types，
// 因此除 extension_settings 外一律通过 SillyTavern.getContext() 全局获取。

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'zuowangtang';

const DEFAULTS = {
    entry_comment: '坐忘堂当前大纲',
};

// 议事提示词：简短、自然、无格式
const COUNCIL_SYSTEM = [
    '你是"坐忘堂"里的梦鲸思客：梦客的编剧搭档，陪他把下一段剧情聊清楚。',
    '你熟悉当前世界书设定与全部上文正文，讨论时直接基于它们，不必复述。',
    '回答要简短、自然、像人说话：直接给看法、给两三个走向、或追问关键偏好；通常几句话说完，最多一小段。',
    '禁止使用XML标签、禁止固定模板、禁止长篇结构化清单、禁止编号大纲式输出。',
    '不要写正文、不要代角色说话。',
    '当梦客表示"就这个/定了/可以写了"时，用一两句话确认最终走向要点即可；写作大纲由面板自动整理，你无需输出任何格式。',
].join('\n');

const CONDENSE_SYSTEM = [
    '把下面这段"坐忘堂"议事记录整理成一份写作大纲。',
    '只输出一个 <dream_outline> XML 文档，不要输出任何其它文字、不要代码块。',
    '字段：scene / cast(内含<actor name=".." state=".."/>) / tone / beats(至少3条<beat n="N">) / nsfw(level属性0-5) / length(数字) / ending_hook / constraints(内含<must>与<ban>) / open_questions(无则填"无")。',
    '只写讨论中已确定的内容；仍未确定的写入 open_questions。',
].join('\n');

let history = [];
let busy = false;
let overlayEl = null, cardEl = null, listEl = null, inputEl = null, statusEl = null;

const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};
const getContext = () => window.SillyTavern.getContext();
const chatKey = () => 'zwt_council_history_' + (getContext().getCurrentChatId?.() || 'default');
const loadHistory = () => { try { history = JSON.parse(localStorage.getItem(chatKey()) || '[]'); } catch (e) { history = []; } };
const saveHistory = () => { try { localStorage.setItem(chatKey(), JSON.stringify(history)); } catch (e) { } };

function buildQuietPrompt(userMsg) {
    const transcript = history.map(m => (m.role === 'user' ? '梦客：' : '思客：') + m.text).join('\n\n');
    return [
        COUNCIL_SYSTEM, '',
        '【既往议事记录】', transcript || '（无，本次为议事开端）', '',
        '【梦客最新发言】', userMsg, '',
        '请用简短自然的语言回复本次议事（不要XML、不要模板）。',
    ].join('\n');
}

function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }

function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!history.length) {
        const empty = el('div', 'zwt-empty');
        empty.textContent = '和思客聊聊下一段剧情吧。';
        listEl.appendChild(empty);
        return;
    }
    history.forEach(m => {
        const row = el('div', 'zwt-row ' + (m.role === 'user' ? 'zwt-row-user' : 'zwt-row-ai'));
        const bubble = el('div', 'zwt-text');
        bubble.textContent = m.text;
        row.appendChild(bubble);
        listEl.appendChild(row);
    });
    listEl.scrollTop = listEl.scrollHeight;
}

function openPanel() {
    overlayEl.style.display = 'flex';
    render();
    setTimeout(() => inputEl?.focus(), 50);
}
function closePanel() { overlayEl.style.display = 'none'; }

// 议事期间临时注入扩展提示词，并尽力关闭写作类输出模式，避免 quiet 调用被写作协议带偏
function withCouncilContext(fn) {
    const ctx = getContext();
    const W = '881044e5-cbef-43c7-ad19-c6e7f6d150b4'; // 梦鲸系写作模式（若存在）
    const order = ctx.chatCompletionSettings?.prompt_order?.[0]?.order || [];
    const w = order.find(o => o.identifier === W);
    const had = w ? w.enabled : null;
    if (w) w.enabled = false;
    try { ctx.setExtensionPrompt?.(MODULE_NAME + '_council', COUNCIL_SYSTEM, 1, 0, true); } catch (e) { }
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            if (w && had !== null) w.enabled = had;
            try { ctx.setExtensionPrompt?.(MODULE_NAME + '_council', '', 1, 0, true); } catch (e) { }
        });
}

async function doSend() {
    const text = (inputEl.value || '').trim();
    if (!text || busy) return;
    busy = true; setStatus('思客思考中…');
    inputEl.value = '';
    history.push({ role: 'user', text }); saveHistory(); render();
    try {
        const ctx = getContext();
        const reply = await withCouncilContext(() => ctx.generateQuietPrompt(buildQuietPrompt(text)));
        const clean = (reply || '').trim() || '（思客未返回内容，请重试或检查 API 连接）';
        history.push({ role: 'ai', text: clean }); saveHistory(); render();
        setStatus('');
    } catch (e) {
        setStatus('调用失败：' + (e?.message || e));
        history.push({ role: 'ai', text: '（调用失败：' + (e?.message || e) + '）' }); saveHistory(); render();
    } finally { busy = false; }
}

async function resolveActiveWorld() {
    try { const bp = document.getElementById('bp-wb-select'); if (bp && bp.value) return bp.value; } catch (e) { }
    try { const s = document.getElementById('world_info'); if (s && s.value) return s.value; } catch (e) { }
    try {
        const pu = getContext().powerUserSettings || {};
        if (Array.isArray(pu.world_info) && pu.world_info.length) return pu.world_info[0];
    } catch (e) { }
    return null;
}

async function doApply() {
    if (!history.length) { setStatus('还没有讨论内容。'); return; }
    busy = true; setStatus('正在把讨论整理成写作大纲…');
    try {
        const ctx = getContext();
        const transcript = history.map(m => (m.role === 'user' ? '梦客：' : '思客：') + m.text).join('\n\n');
        const doc = await withCouncilContext(() => ctx.generateQuietPrompt(CONDENSE_SYSTEM + '\n\n' + transcript));
        const m = (doc || '').match(/<dream_outline[\s\S]*?<\/dream_outline>/);
        if (!m) { setStatus('整理失败：请再聊一轮把走向说定，或重试。'); return; }
        const outline = m[0];
        setStatus('正在写入世界书…');
        const wi = await import('../../../world-info.js');
        const name = await resolveActiveWorld();
        if (!name) { setStatus('未找到激活的世界书。'); return; }
        const data = await wi.loadWorldInfo(name);
        if (!data) { setStatus('世界书加载失败：' + name); return; }
        const comment = extension_settings[MODULE_NAME].entry_comment;
        const ents = () => Object.values(data.entries || {});
        let entry = ents().find(x => x && x.comment === comment);
        if (!entry) entry = wi.createWorldInfoEntry(name, data);
        entry.comment = comment;
        entry.content = outline;
        entry.constant = true;
        entry.disable = false;
        entry.key = []; entry.keysecondary = [];
        entry.order = 999;
        await wi.saveWorldInfo(name, data, true);
        history.push({ role: 'ai', text: '大纲已应用到世界书，回主聊天发写作指令即可按它写。' });
        saveHistory(); render();
        setStatus('已完成。');
    } catch (e) {
        setStatus('失败：' + (e?.message || e));
    } finally { busy = false; }
}

function buildUI() {
    if (document.querySelector('.zwt-fab')) return;

    // ---- 右下角入口按钮 ----
    const fab = el('button', 'zwt-fab', '坐忘堂');
    fab.title = '打开坐忘堂议事面板（讨论不进主聊天）';
    fab.addEventListener('pointerdown', e => { e.stopPropagation(); openPanel(); }, true);
    document.body.appendChild(fab);

    // ---- 遮罩 + 居中卡片（普通 AI 问答式） ----
    overlayEl = el('div', 'zwt-overlay');
    overlayEl.addEventListener('pointerdown', e => { if (e.target === overlayEl) closePanel(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

    cardEl = el('div', 'zwt-card');

    // 头部
    const head = el('div', 'zwt-head');
    const title = el('div', 'zwt-title', '坐忘堂');
    const sub = el('div', 'zwt-subtitle', '剧情议事 · 讨论不进主聊天');
    const headTxt = el('div', 'zwt-headtxt');
    headTxt.appendChild(title); headTxt.appendChild(sub);
    const closeBtn = el('button', 'zwt-close', '×');
    closeBtn.addEventListener('pointerdown', e => { e.stopPropagation(); closePanel(); }, true);
    head.appendChild(headTxt);
    head.appendChild(closeBtn);
    cardEl.appendChild(head);

    // 对话区
    listEl = el('div', 'zwt-list');
    cardEl.appendChild(listEl);

    // 状态行
    statusEl = el('div', 'zwt-status');
    cardEl.appendChild(statusEl);

    // 输入区
    const foot = el('div', 'zwt-foot');
    const inputWrap = el('div', 'zwt-inputwrap');
    inputEl = el('textarea', 'zwt-input');
    inputEl.rows = 2;
    inputEl.placeholder = '输入消息，Enter 发送，Shift+Enter 换行';
    const sendBtn = el('button', 'zwt-send', '发送');
    sendBtn.addEventListener('pointerdown', e => { e.stopPropagation(); doSend(); }, true);
    inputWrap.appendChild(inputEl);
    inputWrap.appendChild(sendBtn);
    foot.appendChild(inputWrap);

    const ops = el('div', 'zwt-ops');
    const mkOp = (t, fn) => {
        const b = el('button', 'zwt-op', t);
        b.addEventListener('pointerdown', e => { e.stopPropagation(); fn(); }, true);
        return b;
    };
    ops.appendChild(mkOp('应用大纲到正文', doApply));
    ops.appendChild(mkOp('清空讨论', () => { if (confirm('清空本聊天的坐忘堂讨论记录？')) { history = []; saveHistory(); render(); } }));
    foot.appendChild(ops);
    cardEl.appendChild(foot);

    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);

    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
}

function boot() {
    if (!window.SillyTavern || !window.SillyTavern.getContext || !document.body) { setTimeout(boot, 500); return; }
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
    for (const k of Object.keys(DEFAULTS)) {
        if (!(k in extension_settings[MODULE_NAME])) extension_settings[MODULE_NAME][k] = DEFAULTS[k];
    }
    try { getContext().saveSettingsDebounced?.(); } catch (e) { }
    loadHistory();
    buildUI();
    try {
        const ctx = getContext();
        ctx.eventSource?.on?.(ctx.eventTypes?.CHAT_CHANGED, () => { loadHistory(); render(); });
    } catch (e) { }
    window.__zwt = {
        get history() { return history; },
        setHistory(h) { history = h; saveHistory(); render(); },
        send: doSend,
        apply: doApply,
        open: openPanel,
        close: closePanel,
    };
    console.log('[坐忘堂] 扩展已加载');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

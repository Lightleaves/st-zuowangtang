// 坐忘堂 · SillyTavern 原生扩展
// 在正文聊天之外提供议事面板：讨论用 generateQuietPrompt（不进聊天），
// 大纲写入当前激活世界书的 constant 条目，供写作类预设自动消费。
// 与任何预设解耦：不依赖预设内嵌脚本、不依赖 TavernHelper。
//
// 注意：本服务器环境的 script.js 未导出 getContext/eventSource/event_types，
// 因此除 extension_settings 外一律通过 SillyTavern.getContext() 全局获取。

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'zuowangtang';

const DEFAULTS = {
    entry_comment: '坐忘堂当前大纲',
    panel_width: 460,
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
let panelEl = null, listEl = null, inputEl = null, statusEl = null;

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
    listEl.innerHTML = '';
    if (!history.length) listEl.appendChild(el('div', null, '（尚无议事记录。发送第一条消息开始与思客讨论下一段剧情。）'));
    history.forEach(m => {
        const bubble = el('div', 'zwt-bubble ' + (m.role === 'user' ? 'zwt-user' : 'zwt-ai'));
        const tag = el('div', 'zwt-tag', m.role === 'user' ? '梦客' : '思客');
        bubble.appendChild(tag);
        bubble.appendChild(document.createTextNode(m.text));
        listEl.appendChild(bubble);
    });
    listEl.scrollTop = listEl.scrollHeight;
}

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
    busy = true; setStatus('思客议事中…（不写入主聊天）');
    inputEl.value = '';
    history.push({ role: 'user', text }); saveHistory(); render();
    try {
        const ctx = getContext();
        const reply = await withCouncilContext(() => ctx.generateQuietPrompt(buildQuietPrompt(text)));
        const clean = (reply || '').trim() || '（思客未返回内容，请重试或检查 API 连接）';
        history.push({ role: 'ai', text: clean }); saveHistory(); render();
        setStatus('完成。可继续讨论，或点"应用大纲到正文"。');
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
    if (!history.length) { setStatus('尚无议事记录，无法整理大纲。'); return; }
    setStatus('正在把讨论整理成写作大纲…');
    try {
        const ctx = getContext();
        const transcript = history.map(m => (m.role === 'user' ? '梦客：' : '思客：') + m.text).join('\n\n');
        const doc = await withCouncilContext(() => ctx.generateQuietPrompt(CONDENSE_SYSTEM + '\n\n' + transcript));
        const m = (doc || '').match(/<dream_outline[\s\S]*?<\/dream_outline>/);
        if (!m) { setStatus('整理失败：未得到大纲。请再聊一轮把走向说定，或重试。'); return; }
        const outline = m[0];
        setStatus('正在写入世界书常量条目…');
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
        history.push({ role: 'ai', text: '【大纲已应用到世界书「' + name + '」，回主聊天发写作指令即可按它写。】' });
        saveHistory(); render();
        setStatus('完成。写作模式将自动消费该大纲。');
    } catch (e) {
        setStatus('失败：' + (e?.message || e));
    }
}

function buildUI() {
    if (document.querySelector('.zwt-fab')) return;
    const fab = el('button', 'zwt-fab', '坐忘堂');
    fab.title = '打开坐忘堂议事面板（讨论不进主聊天）';
    // 用 pointerdown 捕获绑定：部分扩展会在捕获层吞掉 click 事件
    fab.addEventListener('pointerdown', e => {
        e.stopPropagation();
        panelEl.style.display = (panelEl.style.display === 'none') ? 'flex' : 'none';
        if (panelEl.style.display === 'flex') render();
    }, true);
    document.body.appendChild(fab);

    panelEl = el('div', 'zwt-panel');
    const head = el('div', 'zwt-head');
    head.appendChild(el('strong', null, '坐忘堂 · 议事面板'));
    const hint = el('span', 'zwt-hint', '讨论不进主聊天');
    head.appendChild(hint);
    panelEl.appendChild(head);

    statusEl = el('div', 'zwt-status');
    panelEl.appendChild(statusEl);

    listEl = el('div', 'zwt-list');
    panelEl.appendChild(listEl);

    const foot = el('div', 'zwt-foot');
    inputEl = el('textarea', 'zwt-input');
    inputEl.placeholder = '与思客议事…（Enter 发送，Shift+Enter 换行）';
    foot.appendChild(inputEl);
    const btnRow = el('div', 'zwt-btnrow');
    const mk = (t, fn) => { const b = el('button', 'zwt-btn', t); b.addEventListener('pointerdown', e => { e.stopPropagation(); fn(); }, true); return b; };
    btnRow.appendChild(mk('发送议事', doSend));
    btnRow.appendChild(mk('应用大纲到正文', doApply));
    btnRow.appendChild(mk('清空讨论', () => { if (confirm('清空本聊天的坐忘堂讨论记录？')) { history = []; saveHistory(); render(); } }));
    foot.appendChild(btnRow);
    panelEl.appendChild(foot);
    document.body.appendChild(panelEl);

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
    // 切换聊天时重载议事历史（事件接口可用才挂）
    try {
        const ctx = getContext();
        ctx.eventSource?.on?.(ctx.eventTypes?.CHAT_CHANGED, () => { loadHistory(); render(); });
    } catch (e) { }
    // 联调钩子
    window.__zwt = {
        get history() { return history; },
        setHistory(h) { history = h; saveHistory(); render(); },
        send: doSend,
        apply: doApply,
    };
    console.log('[坐忘堂] 扩展已加载');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

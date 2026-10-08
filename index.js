// 坐忘堂 · SillyTavern 原生扩展
// 正文之外的"剧情议事"面板：多轮讨论（generateQuietPrompt，不进主聊天）。
// 每条思客回复带「选中」按钮 → 一键把该回复填入 ST 主聊天输入框。
// 不再写世界书、不再整理大纲，与任何预设解耦。
//
// 注意：本服务器环境的 script.js 未导出 getContext/eventSource/event_types，
// 因此除 extension_settings 外一律通过 SillyTavern.getContext() 全局获取。

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'zuowangtang';

// 议事提示词：简短、自然、无格式；产出可直接被"选中"填入主聊天的文字
const COUNCIL_SYSTEM = [
    '你是"坐忘堂"里的梦鲸思客：梦客的编剧搭档，陪他把下一段剧情聊清楚。',
    '你熟悉当前世界书设定与全部上文正文，讨论时直接基于它们，不必复述。',
    '回答要简短、自然、像人说话：直接给看法、给两三个走向、或追问关键偏好；通常几句话说完，最多一小段。',
    '禁止使用XML标签、禁止固定模板、禁止长篇结构化清单、禁止编号大纲式输出。',
    '不要写正文、不要代角色说话。',
    '你的每条回复都会被梦客一键"选中"后填入主聊天输入框、作为下一段的写作指令，所以请把每条回复写成可以直接当作剧情指令/大纲要点的自然文字。',
].join('\n');

let history = [];
let busy = false;
let overlayEl = null, listEl = null, inputEl = null, statusEl = null;

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

// 把某条思客回复填入 ST 主聊天输入框
function pickToInput(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) { setStatus('未找到主聊天输入框。'); return; }
    const cur = (ta.value || '').trim();
    ta.value = cur ? (cur + '\n\n' + text) : text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    closePanel();
    ta.focus();
}

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
        const col = el('div', 'zwt-col');
        const bubble = el('div', 'zwt-text');
        bubble.textContent = m.text;
        col.appendChild(bubble);
        if (m.role === 'ai') {
            const pick = el('button', 'zwt-pick', '选中 → 填入输入框');
            pick.addEventListener('pointerdown', e => { e.stopPropagation(); pickToInput(m.text); }, true);
            col.appendChild(pick);
        }
        row.appendChild(col);
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

    const cardEl = el('div', 'zwt-card');

    const head = el('div', 'zwt-head');
    const title = el('div', 'zwt-title', '坐忘堂');
    const sub = el('div', 'zwt-subtitle', '剧情议事 · 回复可一键选中填入输入框');
    const headTxt = el('div', 'zwt-headtxt');
    headTxt.appendChild(title); headTxt.appendChild(sub);
    const closeBtn = el('button', 'zwt-close', '×');
    closeBtn.addEventListener('pointerdown', e => { e.stopPropagation(); closePanel(); }, true);
    head.appendChild(headTxt);
    head.appendChild(closeBtn);
    cardEl.appendChild(head);

    listEl = el('div', 'zwt-list');
    cardEl.appendChild(listEl);

    statusEl = el('div', 'zwt-status');
    cardEl.appendChild(statusEl);

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
    const clearBtn = el('button', 'zwt-op', '清空讨论');
    clearBtn.addEventListener('pointerdown', e => { e.stopPropagation(); if (confirm('清空本聊天的坐忘堂讨论记录？')) { history = []; saveHistory(); render(); setStatus(''); } }, true);
    ops.appendChild(clearBtn);
    foot.appendChild(ops);
    cardEl.appendChild(foot);

    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);

    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
}

function boot() {
    if (!window.SillyTavern || !window.SillyTavern.getContext || !document.body) { setTimeout(boot, 500); return; }
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
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
        pick: pickToInput,
        open: openPanel,
        close: closePanel,
    };
    console.log('[坐忘堂] 扩展已加载');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

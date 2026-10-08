// 坐忘堂 · SillyTavern 原生扩展
// 正文之外的"剧情议事"面板：多轮讨论（generateQuietPrompt，不进主聊天）。
// 每条思客回复带「选中」按钮 → 一键把该回复填入 ST 主聊天输入框。
// 「思客设定」自定义讨论者角色；「系统提示词」维护一条条默认约束（回复不得与之矛盾）。
// 不写世界书、与任何预设解耦。
//
// 注意：本服务器环境的 script.js 未导出 getContext/eventSource/event_types，
// 因此除 extension_settings 外一律通过 SillyTavern.getContext() 全局获取。

import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'zuowangtang';
const PERSONA_KEY = 'zwt_persona';
const SYSPROMPT_KEY = 'zwt_sysprompts';

const DEFAULT_PERSONA = {
    name: '思客',
    personality: '冷静、专业的剧情参谋，善于提出多个走向并明确推荐；对梦客友善但不谄媚。',
    style: '简短自然，像朋友/编剧搭档聊天。',
    catchphrase: '',
    extra: '',
};

let persona = { ...DEFAULT_PERSONA };
let sysPrompts = [];
let history = [];
let busy = false;
let overlayEl = null, listEl = null, inputEl = null, statusEl = null;
let viewChat = null, viewSettings = null, viewSys = null;
let formRefs = null, sysListEl = null, sysInputEl = null;

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

function loadPersona() {
    try {
        const raw = localStorage.getItem(PERSONA_KEY);
        persona = raw ? { ...DEFAULT_PERSONA, ...JSON.parse(raw) } : { ...DEFAULT_PERSONA };
    } catch (e) { persona = { ...DEFAULT_PERSONA }; }
}
function savePersona() { try { localStorage.setItem(PERSONA_KEY, JSON.stringify(persona)); } catch (e) { } }

function loadSysPrompts() {
    try { const raw = localStorage.getItem(SYSPROMPT_KEY); const a = raw ? JSON.parse(raw) : []; sysPrompts = Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : []; }
    catch (e) { sysPrompts = []; }
}
function saveSysPrompts() { try { localStorage.setItem(SYSPROMPT_KEY, JSON.stringify(sysPrompts)); } catch (e) { } }

// 依据当前思客设定 + 系统提示词拼装系统提示词
function councilSystemPrompt() {
    const p = persona || {};
    const name = (p.name || '').trim() || '思客';
    const lines = [];
    lines.push(`你是"坐忘堂"里的${name}：梦客的剧情议事搭档。`);
    if ((p.personality || '').trim()) lines.push(`【性格】${p.personality.trim()}`);
    if ((p.style || '').trim()) lines.push(`【语言风格】${p.style.trim()}`);
    if ((p.catchphrase || '').trim()) lines.push(`【口头禅/常用语】${p.catchphrase.trim()}（自然地偶尔使用以体现个性，不要每句都塞）`);
    if ((p.extra || '').trim()) lines.push(`【其它设定】${p.extra.trim()}`);
    lines.push('你熟悉当前世界书设定与全部上文正文，讨论时直接基于它们，不必复述。');
    lines.push('回答要简短、自然、像人说话：直接给看法、给两三个走向、或追问关键偏好；通常几句话说完，最多一小段。');
    lines.push('禁止使用XML标签、禁止固定模板、禁止长篇结构化清单、禁止编号大纲式输出。');
    lines.push('不要写正文、不要代角色说话。');
    lines.push('你的每条回复都会被梦客一键"选中"后填入主聊天输入框、作为下一段的写作指令，所以请把每条回复写成可以直接当作剧情指令/大纲要点的自然文字。');
    if (sysPrompts.length) {
        lines.push('');
        lines.push('【默认设定（每次回复都必须纳入考虑，绝不能与之矛盾；但不必在回复里逐条复述或刻意体现）】');
        sysPrompts.forEach(s => lines.push(`- ${s}`));
    }
    return lines.join('\n');
}

function buildQuietPrompt(userMsg) {
    const transcript = history.map(m => (m.role === 'user' ? '梦客：' : '思客：') + m.text).join('\n\n');
    return [
        councilSystemPrompt(), '',
        '【既往议事记录】', transcript || '（无，本次为议事开端）', '',
        '【梦客最新发言】', userMsg, '',
        `请保持${(persona.name || '思客').trim() || '思客'}的口吻，用简短自然的语言回复本次议事（不要XML、不要模板）。`,
    ].join('\n');
}

function setStatus(t) { if (statusEl) statusEl.textContent = t || ''; }

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

// ---- 视图切换 ----
function setView(which) {
    viewChat.style.display = which === 'chat' ? 'flex' : 'none';
    viewSettings.style.display = which === 'settings' ? 'flex' : 'none';
    viewSys.style.display = which === 'sys' ? 'flex' : 'none';
}
function openPanel() {
    overlayEl.style.display = 'flex';
    setView('chat');
    render();
    setTimeout(() => inputEl?.focus(), 50);
}
function closePanel() { overlayEl.style.display = 'none'; }

function showSettingsView() {
    if (formRefs) {
        formRefs.name.value = persona.name || '';
        formRefs.personality.value = persona.personality || '';
        formRefs.style.value = persona.style || '';
        formRefs.catchphrase.value = persona.catchphrase || '';
        formRefs.extra.value = persona.extra || '';
    }
    setView('settings');
}
function saveSettings() {
    persona.name = (formRefs.name.value || '').trim();
    persona.personality = (formRefs.personality.value || '').trim();
    persona.style = (formRefs.style.value || '').trim();
    persona.catchphrase = (formRefs.catchphrase.value || '').trim();
    persona.extra = (formRefs.extra.value || '').trim();
    savePersona();
    setView('chat');
    render();
    setStatus('思客设定已保存。');
}
function resetSettings() { persona = { ...DEFAULT_PERSONA }; savePersona(); showSettingsView(); setStatus('已恢复默认思客设定。'); }

// ---- 系统提示词视图 ----
function renderSysList() {
    if (!sysListEl) return;
    sysListEl.innerHTML = '';
    if (!sysPrompts.length) {
        const empty = el('div', 'zwt-empty');
        empty.textContent = '还没有系统提示词。在上方输入并点"添加"。';
        sysListEl.appendChild(empty);
        return;
    }
    sysPrompts.forEach((s, i) => {
        const item = el('div', 'zwt-sys-item');
        const txt = el('div', 'zwt-sys-text');
        txt.textContent = s;
        const del = el('button', 'zwt-sys-del', '删除');
        del.addEventListener('pointerdown', e => { e.stopPropagation(); removeSysPrompt(i); }, true);
        item.appendChild(txt); item.appendChild(del);
        sysListEl.appendChild(item);
    });
}
function addSysPrompt() {
    const v = (sysInputEl.value || '').trim();
    if (!v) return;
    sysPrompts.push(v);
    saveSysPrompts();
    sysInputEl.value = '';
    renderSysList();
    setStatus('已添加 1 条系统提示词。');
}
function removeSysPrompt(i) {
    sysPrompts.splice(i, 1);
    saveSysPrompts();
    renderSysList();
}
function showSysView() { renderSysList(); setView('sys'); setTimeout(() => sysInputEl?.focus(), 50); }

function withCouncilContext(fn) {
    const ctx = getContext();
    const W = '881044e5-cbef-43c7-ad19-c6e7f6d150b4';
    const order = ctx.chatCompletionSettings?.prompt_order?.[0]?.order || [];
    const w = order.find(o => o.identifier === W);
    const had = w ? w.enabled : null;
    if (w) w.enabled = false;
    try { ctx.setExtensionPrompt?.(MODULE_NAME + '_council', councilSystemPrompt(), 1, 0, true); } catch (e) { }
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

function makeField(labelText, placeholder) {
    const wrap = el('div', 'zwt-field');
    const label = el('label', 'zwt-label', labelText);
    const ta = el('textarea', 'zwt-field-input');
    ta.rows = 2;
    ta.placeholder = placeholder || '';
    wrap.appendChild(label); wrap.appendChild(ta);
    return { wrap, ta };
}

function buildSettingsView() {
    const view = el('div', 'zwt-settings zwt-view');
    view.appendChild(el('div', 'zwt-settings-tip', '设定"讨论者"这个角色：名字、性格、语言风格、口头禅等。保存后对之后的每条议事回复生效。'));
    const nameWrap = el('div', 'zwt-field');
    nameWrap.appendChild(el('label', 'zwt-label', '名字'));
    const nameInput = el('input', 'zwt-field-input zwt-field-line');
    nameInput.type = 'text'; nameInput.placeholder = '思客';
    nameWrap.appendChild(nameInput); view.appendChild(nameWrap);
    const f1 = makeField('性格', '例：冷静专业、爱抬杠、温柔体贴……');
    const f2 = makeField('语言风格', '例：简短利落 / 文绉绉 / 口语化带梗……');
    const f3 = makeField('口头禅 / 常用语', '例：「有点意思」「这事我熟」……');
    const f4 = makeField('其它补充设定', '身份背景、偏好、禁忌等，可留空');
    view.appendChild(f1.wrap); view.appendChild(f2.wrap); view.appendChild(f3.wrap); view.appendChild(f4.wrap);
    const btnRow = el('div', 'zwt-settings-btns');
    const saveBtn = el('button', 'zwt-save', '保存');
    saveBtn.addEventListener('pointerdown', e => { e.stopPropagation(); saveSettings(); }, true);
    const backBtn = el('button', 'zwt-cancel', '返回');
    backBtn.addEventListener('pointerdown', e => { e.stopPropagation(); setView('chat'); }, true);
    const resetBtn = el('button', 'zwt-reset', '恢复默认');
    resetBtn.addEventListener('pointerdown', e => { e.stopPropagation(); if (confirm('恢复默认思客设定？')) resetSettings(); }, true);
    btnRow.appendChild(saveBtn); btnRow.appendChild(backBtn); btnRow.appendChild(resetBtn);
    view.appendChild(btnRow);
    formRefs = { name: nameInput, personality: f1.ta, style: f2.ta, catchphrase: f3.ta, extra: f4.ta };
    return view;
}

function buildSysView() {
    const view = el('div', 'zwt-settings zwt-view');
    view.appendChild(el('div', 'zwt-settings-tip', '一条条的默认约束。每次议事回复都会纳入考虑，绝不能与之矛盾（但不必在回复里逐条体现）。'));
    const addRow = el('div', 'zwt-sys-add');
    sysInputEl = el('input', 'zwt-field-input zwt-field-line zwt-sys-input');
    sysInputEl.type = 'text';
    sysInputEl.placeholder = '输入一条系统提示词，回车或点"添加"';
    sysInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSysPrompt(); } });
    const addBtn = el('button', 'zwt-save', '添加');
    addBtn.addEventListener('pointerdown', e => { e.stopPropagation(); addSysPrompt(); }, true);
    addRow.appendChild(sysInputEl); addRow.appendChild(addBtn);
    view.appendChild(addRow);
    sysListEl = el('div', 'zwt-sys-list');
    view.appendChild(sysListEl);
    const btnRow = el('div', 'zwt-settings-btns');
    const backBtn = el('button', 'zwt-cancel', '返回');
    backBtn.addEventListener('pointerdown', e => { e.stopPropagation(); setView('chat'); }, true);
    btnRow.appendChild(backBtn);
    view.appendChild(btnRow);
    return view;
}

function buildUI() {
    if (document.querySelector('.zwt-fab')) return;

    const fab = el('button', 'zwt-fab', '坐忘堂');
    fab.title = '打开坐忘堂议事面板（讨论不进主聊天）';
    fab.addEventListener('pointerdown', e => { e.stopPropagation(); openPanel(); }, true);
    document.body.appendChild(fab);

    overlayEl = el('div', 'zwt-overlay');
    overlayEl.addEventListener('pointerdown', e => { if (e.target === overlayEl) closePanel(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

    const cardEl = el('div', 'zwt-card');

    const head = el('div', 'zwt-head');
    const headTxt = el('div', 'zwt-headtxt');
    headTxt.appendChild(el('div', 'zwt-title', '坐忘堂'));
    headTxt.appendChild(el('div', 'zwt-subtitle', '剧情议事 · 回复可一键选中填入输入框'));
    const headBtns = el('div', 'zwt-headbtns');
    const sysBtn = el('button', 'zwt-gear', '系统提示词');
    sysBtn.addEventListener('pointerdown', e => { e.stopPropagation(); showSysView(); }, true);
    const gearBtn = el('button', 'zwt-gear', '思客设定');
    gearBtn.addEventListener('pointerdown', e => { e.stopPropagation(); showSettingsView(); }, true);
    const closeBtn = el('button', 'zwt-close', '×');
    closeBtn.addEventListener('pointerdown', e => { e.stopPropagation(); closePanel(); }, true);
    headBtns.appendChild(sysBtn); headBtns.appendChild(gearBtn); headBtns.appendChild(closeBtn);
    head.appendChild(headTxt); head.appendChild(headBtns);
    cardEl.appendChild(head);

    viewChat = el('div', 'zwt-view zwt-view-chat');
    listEl = el('div', 'zwt-list');
    viewChat.appendChild(listEl);
    statusEl = el('div', 'zwt-status');
    viewChat.appendChild(statusEl);
    const foot = el('div', 'zwt-foot');
    const inputWrap = el('div', 'zwt-inputwrap');
    inputEl = el('textarea', 'zwt-input');
    inputEl.rows = 2;
    inputEl.placeholder = '输入消息，Enter 发送，Shift+Enter 换行';
    const sendBtn = el('button', 'zwt-send', '发送');
    sendBtn.addEventListener('pointerdown', e => { e.stopPropagation(); doSend(); }, true);
    inputWrap.appendChild(inputEl); inputWrap.appendChild(sendBtn);
    foot.appendChild(inputWrap);
    const ops = el('div', 'zwt-ops');
    const clearBtn = el('button', 'zwt-op', '清空讨论');
    clearBtn.addEventListener('pointerdown', e => { e.stopPropagation(); if (confirm('清空本聊天的坐忘堂讨论记录？')) { history = []; saveHistory(); render(); setStatus(''); } }, true);
    ops.appendChild(clearBtn);
    foot.appendChild(ops);
    viewChat.appendChild(foot);
    cardEl.appendChild(viewChat);

    viewSettings = buildSettingsView();
    viewSettings.style.display = 'none';
    cardEl.appendChild(viewSettings);

    viewSys = buildSysView();
    viewSys.style.display = 'none';
    cardEl.appendChild(viewSys);

    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);

    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
}

function boot() {
    if (!window.SillyTavern || !window.SillyTavern.getContext || !document.body) { setTimeout(boot, 500); return; }
    if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
    loadPersona();
    loadSysPrompts();
    loadHistory();
    buildUI();
    try {
        const ctx = getContext();
        ctx.eventSource?.on?.(ctx.eventTypes?.CHAT_CHANGED, () => { loadHistory(); render(); });
    } catch (e) { }
    window.__zwt = {
        get history() { return history; },
        setHistory(h) { history = h; saveHistory(); render(); },
        get persona() { return persona; },
        setPersona(p) { persona = { ...DEFAULT_PERSONA, ...(p || {}) }; savePersona(); render(); },
        get sysPrompts() { return sysPrompts.slice(); },
        addSysPrompt(t) { const v = (t || '').trim(); if (v) { sysPrompts.push(v); saveSysPrompts(); renderSysList(); } },
        removeSysPrompt(i) { sysPrompts.splice(i, 1); saveSysPrompts(); renderSysList(); },
        councilPrompt: () => councilSystemPrompt(),
        send: doSend, pick: pickToInput, open: openPanel, close: closePanel,
        openSettings: showSettingsView, openSys: showSysView,
    };
    console.log('[坐忘堂] 扩展已加载');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

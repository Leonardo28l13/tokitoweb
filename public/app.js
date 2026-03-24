const socket = io();

// UI Elements
const viewOffline = document.getElementById('viewOffline');
const viewOnline = document.getElementById('viewOnline');
const modalShutdown = document.getElementById('modalShutdown');
const statusText = document.getElementById('statusText');
const statusSub = document.getElementById('statusSub');
const statusDot = document.getElementById('statusDot');
const qrBox = document.getElementById('qrBox');
const pairBox = document.getElementById('pairBox');
const logsBox = document.getElementById('logs');
const featuresGrid = document.getElementById('featuresGrid');

// Editor Elements
const caseList = document.getElementById('caseList');
const mobileCaseSelect = document.getElementById('mobileCaseSelect');
const customCodeInput = document.getElementById('customCodeInput');
const iaPrompt = document.getElementById('iaPrompt');
const currentCaseTitle = document.getElementById('currentCaseTitle');
const btnSaveCustom = document.getElementById('btnSaveCustom');
const btnDeleteCase = document.getElementById('btnDeleteCase');

let currentActiveCase = null;
let statsInterval = null;
const casesToSummarize = [];
let isSummarizing = false;

// 🔥 CONTROLO DE VISIBILIDADE DASHBOARD 🔥
function updateView(connected) {
    if (connected) {
        viewOffline.style.display = 'none';
        viewOnline.style.display = 'block';
        if (!statsInterval) {
            fetchStats();
            statsInterval = setInterval(fetchStats, 3000);
        }
    } else {
        viewOffline.style.display = 'grid';
        viewOnline.style.display = 'none';
        clearInterval(statsInterval);
        statsInterval = null;
    }
}

async function fetchStats() {
    try {
        const res = await fetch('/api/system-stats').then(r => r.json());
        document.getElementById('statRam').textContent = `${res.ram.used} / ${res.ram.total}`;
        document.getElementById('ramBar').style.width = `${res.ram.percent}%`;
        document.getElementById('statUptime').textContent = res.uptime;
        document.getElementById('statPlatform').textContent = res.platform;
        document.getElementById('statNode').textContent = res.node;
    } catch (e) {}
}

window.openShutdownModal = () => modalShutdown.style.display = 'grid';
window.closeModal = () => modalShutdown.style.display = 'none';
window.confirmShutdown = async () => { await post('/api/bot/shutdown'); window.location.reload(); };
window.restartBot = async () => { await post('/api/bot/restart'); alert('A reiniciar...'); };

// --- FILA DE RESUMOS IA ---
async function processSummaryQueue() {
    if (isSummarizing || casesToSummarize.length === 0) return;
    isSummarizing = true;
    while (casesToSummarize.length > 0) {
        const name = casesToSummarize.shift();
        const span = document.getElementById(`summary-${name}`);
        if (!span) continue;
        try {
            const res = await post('/api/summarize-case', { name });
            if (res.ok) span.textContent = res.summary;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1500));
    }
    isSummarizing = false;
}

// --- COMANDOS EDITOR ---
async function loadCases() {
    const res = await fetch('/api/custom-cases').then(r=>r.json());
    caseList.innerHTML = '';
    featuresGrid.innerHTML = '';
    if (mobileCaseSelect) mobileCaseSelect.innerHTML = '<option value="">Selecionar...</option>';

    res.cases.forEach(c => {
        // List Desktop
        const li = document.createElement('li');
        li.textContent = `!${c.name}`;
        li.style = `padding:10px 14px; background:${c.name === currentActiveCase ? 'rgba(255,255,255,0.1)' : 'transparent'}; border-radius:10px; cursor:pointer; font-size:14px; color:${c.name === currentActiveCase ? '#fff' : '#888'}`;
        li.onclick = () => openCase(c.name);
        caseList.appendChild(li);

        // Dropdown Mobile
        if (mobileCaseSelect) {
            const opt = document.createElement('option');
            opt.value = c.name; opt.textContent = `!${c.name}`;
            if (c.name === currentActiveCase) opt.selected = true;
            mobileCaseSelect.appendChild(opt);
        }

        // Funções Tab
        const card = document.createElement('div');
        card.className = 'feature-card';
        const desc = c.desc || `<span id="summary-${c.name}" style="color:var(--success); font-size:12px;">✨ A analisar...</span>`;
        card.innerHTML = `<strong>!${c.name}</strong><span>${desc}</span>`;
        featuresGrid.appendChild(card);
        if (!c.desc) casesToSummarize.push(c.name);
    });
    processSummaryQueue();
}

async function openCase(name) {
    currentActiveCase = name;
    currentCaseTitle.textContent = `!${name}`;
    btnSaveCustom.style.display = 'block';
    btnDeleteCase.style.display = 'block';
    customCodeInput.disabled = false;
    const res = await fetch(`/api/custom-cases/${name}`).then(r=>r.json());
    customCodeInput.value = res.code;
    loadCases();
}

// --- EVENTOS ---
document.getElementById('btnQr').onclick = () => post('/api/connect/qr');
document.getElementById('btnPair').onclick = () => post('/api/connect/pairing', { phoneNumber: document.getElementById('phoneNumber').value });
document.getElementById('btnClear').onclick = () => post('/api/session/clear');

document.getElementById('saveConfig').onclick = () => {
    post('/api/config', {
        botName: document.getElementById('botName').value,
        ownerName: document.getElementById('ownerName').value,
        ownerNumber: document.getElementById('ownerNumber').value,
        prefix: document.getElementById('prefix').value
    }).then(() => alert('Salvo!'));
};

btnSaveCustom.onclick = async () => {
    await post(`/api/custom-cases/${currentActiveCase}`, { code: customCodeInput.value });
    alert('Código Guardado!');
};

document.getElementById('btnNewCase').onclick = document.getElementById('btnNewCaseMobile').onclick = async () => {
    const name = prompt('Nome do comando:');
    if (!name) return;
    const clean = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    await post(`/api/custom-cases/${clean}`, { code: `module.exports = async ({ reply }) => {\n  await reply('Olá!');\n};` });
    openCase(clean);
};

btnDeleteCase.onclick = async () => {
    if (!confirm('Apagar?')) return;
    await fetch(`/api/custom-cases/${currentActiveCase}`, { method: 'DELETE' });
    currentActiveCase = null;
    window.location.reload();
};

btnGenerateIA.onclick = async () => {
    const btn = btnGenerateIA;
    const old = btn.textContent;
    btn.textContent = '...';
    try {
        const res = await post('/api/generate-case', { prompt: iaPrompt.value, currentCode: customCodeInput.value });
        if (res.ok) { customCodeInput.value = res.code; iaPrompt.value = ''; iaPrompt.style.height = 'auto'; }
    } catch(e) {}
    btn.textContent = old;
};

iaPrompt.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; });

if (mobileCaseSelect) mobileCaseSelect.onchange = (e) => openCase(e.target.value);

socket.on('bot:state', (state) => {
    const connected = state.connected;
    statusText.textContent = connected ? 'Online' : (state.status === 'awaiting_qr' ? 'QR Code' : 'Offline');
    statusDot.className = `dot ${connected ? 'online' : 'offline'}`;
    statusSub.textContent = connected ? `Ligado como ${state.user?.name || 'Bot'}` : 'A aguardar ligação...';
    updateView(connected);
    if (state.qr) qrBox.innerHTML = `<img src="${state.qr}" style="width:100%; max-width:280px; background:#fff; padding:10px; border-radius:15px;" />`;
    if (state.pairingCode) pairBox.textContent = state.pairingCode;
    document.getElementById('dashBotName').textContent = state.config?.botName || 'Bot';
    document.getElementById('botName').value = state.config?.botName || '';
    document.getElementById('ownerName').value = state.config?.ownerName || '';
    document.getElementById('ownerNumber').value = state.config?.ownerNumber || '';
    document.getElementById('prefix').value = state.config?.prefix || '!';
});

socket.on('bot:log', (log) => {
    const item = document.createElement('div');
    item.className = `log-item ${log.type}`;
    item.innerHTML = `<div class="time">${log.time}</div><div>${log.message}</div>`;
    logsBox.prepend(item);
});

document.querySelectorAll('.side-link').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.side-link, .tab').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    };
});

async function post(url, body = {}) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()); }

fetch('/api/state').then(r => r.json()).then(s => updateView(s.connected));
loadCases();
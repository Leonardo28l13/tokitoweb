const socket = io();

const statusText = document.getElementById('statusText');
const statusSub = document.getElementById('statusSub');
const statusDot = document.getElementById('statusDot');
const qrBox = document.getElementById('qrBox');
const pairBox = document.getElementById('pairBox');
const logsBox = document.getElementById('logs');
const meInfo = document.getElementById('meInfo');
const prefixInfo = document.getElementById('prefixInfo');
const botInfo = document.getElementById('botInfo');

const botName = document.getElementById('botName');
const ownerName = document.getElementById('ownerName');
const ownerNumber = document.getElementById('ownerNumber');
const prefix = document.getElementById('prefix');

const customCodeInput = document.getElementById('customCodeInput');
const btnSaveCustom = document.getElementById('btnSaveCustom');
const btnDeleteCase = document.getElementById('btnDeleteCase');
const btnNewCase = document.getElementById('btnNewCase');
const caseList = document.getElementById('caseList');
const currentCaseTitle = document.getElementById('currentCaseTitle');
const iaPrompt = document.getElementById('iaPrompt');
const btnGenerateIA = document.getElementById('btnGenerateIA');

const mobileCaseSelect = document.getElementById('mobileCaseSelect');
const btnNewCaseMobile = document.getElementById('btnNewCaseMobile');
const featuresGrid = document.getElementById('featuresGrid');

let currentActiveCase = null;

// 🔥 FILA DE RESUMOS AUTOMÁTICOS 🔥
const casesToSummarize = [];
let isSummarizing = false;

async function processSummaryQueue() {
  if (isSummarizing || casesToSummarize.length === 0) return;
  isSummarizing = true;
  
  while (casesToSummarize.length > 0) {
    const name = casesToSummarize.shift();
    const span = document.getElementById(`summary-${name}`);
    if (!span) continue;
    
    try {
      const res = await post('/api/summarize-case', { name });
      if (res.ok) {
        span.style.color = 'var(--muted)';
        span.style.fontSize = '14px';
        span.style.fontStyle = 'normal';
        span.textContent = res.summary;
      } else {
        span.style.color = 'var(--danger)';
        span.textContent = 'Erro na IA. Recarregue a página.';
      }
    } catch (e) {
      span.style.color = 'var(--danger)';
      span.textContent = 'Erro de ligação.';
    }
    
    await new Promise(r => setTimeout(r, 1500));
  }
  
  isSummarizing = false;
}

function setStatus(status, connected) {
  const labels = {
    offline: ['Offline', 'A aguardar ligação do WhatsApp.'],
    connecting: ['A ligar', 'A iniciar sessão do bot...'],
    awaiting_qr: ['A aguardar QR', 'Faça scan do QR Code abaixo.'],
    awaiting_pairing: ['A aguardar código', 'Use o código no WhatsApp.'],
    online: ['Online', 'Bot ligado e pronto.']
  };
  const [title, sub] = labels[status] || ['Offline', 'Sem ligação.'];
  statusText.textContent = title;
  statusSub.textContent = sub;
  statusDot.className = `dot ${connected ? 'online' : (status === 'connecting' || status === 'awaiting_qr' || status === 'awaiting_pairing') ? 'connecting' : 'offline'}`;
}

function renderQR(qr) { qrBox.innerHTML = qr ? `<img src="${qr}" alt="QR Code" />` : `<div class="qr-placeholder">Clique em <b>Gerar QR</b> para ligar</div>`; }
function renderPair(code) { pairBox.textContent = code || 'Nenhum código gerado ainda.'; }
function renderLogs(logs) { logsBox.innerHTML = ''; logs.forEach(log => appendLog(log, true)); }

function appendLog(log, initial = false) {
  const item = document.createElement('div');
  item.className = `log-item ${log.type || 'info'}`;
  item.innerHTML = `<div class="time">${log.time}</div><div>${log.message}</div>`;
  if (initial) logsBox.appendChild(item); else logsBox.prepend(item);
}

function fillConfig(config = {}) {
  botName.value = config.botName || '';
  ownerName.value = config.ownerName || '';
  ownerNumber.value = config.ownerNumber || '';
  prefix.value = config.prefix || '!';
  prefixInfo.textContent = config.prefix || '—';
  botInfo.textContent = config.botName || '—';
}

function fillUser(user) { meInfo.textContent = user?.name || user?.id || '—'; }

async function post(url, body = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

socket.on('bot:state', (state) => {
  setStatus(state.status, state.connected); renderQR(state.qr); renderPair(state.pairingCode); fillConfig(state.config); fillUser(state.user);
});
socket.on('bot:logs', renderLogs);
socket.on('bot:log', appendLog);

document.getElementById('btnQr').onclick = () => post('/api/connect/qr');
document.getElementById('btnPair').onclick = () => post('/api/connect/pairing', { phoneNumber: document.getElementById('phoneNumber').value });
document.getElementById('btnClear').onclick = () => post('/api/session/clear');
document.getElementById('saveConfig').onclick = () => post('/api/config', { botName: botName.value, ownerName: ownerName.value, ownerNumber: ownerNumber.value, prefix: prefix.value });

async function loadCases() {
  const res = await fetch('/api/custom-cases').then(r=>r.json());
  
  caseList.innerHTML = '';
  if (mobileCaseSelect) mobileCaseSelect.innerHTML = '<option value="">Selecione um comando...</option>';
  if (featuresGrid) featuresGrid.innerHTML = '';

  res.cases.forEach(c => {
    const name = c.name;
    const desc = c.desc;

    const li = document.createElement('li');
    li.textContent = `!${name}`;
    li.style.padding = '10px 14px';
    li.style.background = name === currentActiveCase ? 'rgba(255,255,255,0.1)' : 'transparent';
    li.style.borderRadius = '8px';
    li.style.cursor = 'pointer';
    li.style.fontWeight = name === currentActiveCase ? '600' : '400';
    li.style.color = name === currentActiveCase ? '#fff' : 'var(--muted)';
    li.onclick = () => openCase(name);
    caseList.appendChild(li);

    if (mobileCaseSelect) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `!${name}`;
      if (name === currentActiveCase) opt.selected = true;
      mobileCaseSelect.appendChild(opt);
    }

    if (featuresGrid) {
      const card = document.createElement('div');
      card.className = 'feature-card';
      
      if (desc) {
        card.innerHTML = `<strong style="font-size: 16px;">!${name}</strong> <span style="display:block; margin-top:5px; color:var(--muted);">${desc}</span>`;
      } else {
        card.innerHTML = `<strong style="font-size: 16px;">!${name}</strong> <span id="summary-${name}" style="display:block; margin-top:5px; color:var(--success); font-size:12px; font-style:italic;">✨ A analisar código...</span>`;
        if (!casesToSummarize.includes(name)) {
          casesToSummarize.push(name);
        }
      }
      featuresGrid.appendChild(card);
    }
  });

  processSummaryQueue();
}

window.summarizeCase = async (name, btn) => {
  const originalText = btn.textContent;
  btn.textContent = 'A analisar...';
  btn.disabled = true;
  
  try {
    const res = await post('/api/summarize-case', { name });
    if (res.ok) {
      const span = document.createElement('span');
      span.style.display = 'block';
      span.style.marginTop = '5px';
      span.style.color = 'var(--muted)';
      span.textContent = res.summary;
      btn.parentNode.replaceChild(span, btn); 
    } else {
      btn.textContent = 'Erro!';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Sem Ligação';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
  }
};

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

const actionNewCase = async () => {
  const name = prompt('Nome do novo comando (apenas letras e números, sem espaços):');
  if (!name) return;
  const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  if (!cleanName) return alert('Nome inválido!');

  const defaultCode = `module.exports = async ({ tokito, msg, command, args, q, reply, react, prefix, sender, isGroup }) => {\n  await reply('Novo comando !${cleanName} em funcionamento!');\n};`;
  await post(`/api/custom-cases/${cleanName}`, { code: defaultCode });
  openCase(cleanName);
};

btnNewCase.onclick = actionNewCase;
if (btnNewCaseMobile) btnNewCaseMobile.onclick = actionNewCase;

if (mobileCaseSelect) {
  mobileCaseSelect.onchange = (e) => {
    if (e.target.value) openCase(e.target.value);
    else {
      currentActiveCase = null;
      currentCaseTitle.textContent = 'Selecione um comando...';
      customCodeInput.value = '';
      customCodeInput.disabled = true;
      btnSaveCustom.style.display = 'none';
      btnDeleteCase.style.display = 'none';
      loadCases();
    }
  };
}

btnDeleteCase.onclick = async () => {
  if(!confirm(`Excluir permanentemente o comando !${currentActiveCase}?`)) return;
  await fetch(`/api/custom-cases/${currentActiveCase}`, { method: 'DELETE' });
  currentActiveCase = null;
  currentCaseTitle.textContent = 'Selecione um comando...';
  customCodeInput.value = '';
  customCodeInput.disabled = true;
  btnSaveCustom.style.display = 'none';
  btnDeleteCase.style.display = 'none';
  loadCases();
};

btnSaveCustom.onclick = async () => {
  if(!currentActiveCase) return;
  const txtOriginal = btnSaveCustom.textContent;
  btnSaveCustom.textContent = 'A guardar...';
  await post(`/api/custom-cases/${currentActiveCase}`, { code: customCodeInput.value });
  btnSaveCustom.textContent = 'Guardado! ✓';
  setTimeout(() => { btnSaveCustom.textContent = txtOriginal; }, 2000);
};

// Auto expansão nativa
iaPrompt.addEventListener('input', function() {
  this.style.height = 'auto'; 
  this.style.height = (this.scrollHeight) + 'px'; 
});

// AQUI ESTÁ A CORREÇÃO: Removi por completo a interceção do "Enter". 
// O comportamento natural de quebrar linha já funciona perfeitamente por defeito.

btnGenerateIA.onclick = async () => {
  const prompt = iaPrompt.value.trim();
  if (!prompt) return;
  if (!currentActiveCase) return alert('Por favor, selecione ou crie um comando primeiro.');
  
  const txtOriginal = btnGenerateIA.textContent;
  btnGenerateIA.textContent = '⏳ ...';
  btnGenerateIA.disabled = true;

  try {
    const res = await post('/api/generate-case', { prompt, currentCode: customCodeInput.value });
    if (res.ok) {
      customCodeInput.value = res.code;
      iaPrompt.value = '';
      iaPrompt.style.height = 'auto'; 
    } else {
      alert('Erro: ' + (res.error || 'Falha na IA'));
    }
  } catch (e) {
    alert('Erro de ligação com a API.');
  }

  btnGenerateIA.textContent = txtOriginal;
  btnGenerateIA.disabled = false;
};

document.querySelectorAll('.side-link').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.side-link').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  };
});

fetch('/api/state').then(r => r.json()).then((state) => {
  setStatus(state.status, state.connected); renderQR(state.qr); renderPair(state.pairingCode); fillConfig(state.config); fillUser(state.user);
  loadCases(); 
});
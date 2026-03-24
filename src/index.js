const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const fs = require('fs');
const os = require('os');

const { initDB, getConfig, setConfig } = require('./lib/db');
const { normalizePhone, formatRuntime } = require('./lib/helpers');
const botEngine = require('./bot/connect'); 

initDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const customDir = path.join(__dirname, 'bot', 'custom');
if (!fs.existsSync(customDir)) { fs.mkdirSync(customDir, { recursive: true }); }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// --- ROTAS DE SISTEMA ---
app.get('/api/system-stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  res.json({
    ram: {
      used: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      percent: Math.round((usedMem / totalMem) * 100)
    },
    uptime: formatRuntime(process.uptime()),
    platform: os.platform(),
    node: process.version
  });
});

app.post('/api/bot/restart', (req, res) => {
  botEngine.clearSession(io);
  setTimeout(() => botEngine.iniciarBot(io), 2000);
  res.json({ ok: true });
});

app.post('/api/bot/shutdown', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 1000);
});

// --- ROTAS DE CONFIGURAÇÃO E ESTADO ---
app.get('/api/state', (req, res) => res.json({ ...botEngine.webState, config: getConfig() }));
app.post('/api/connect/qr', (req, res) => { botEngine.iniciarBot(io, 'qr'); res.json({ ok: true }); });
app.post('/api/connect/pairing', (req, res) => { botEngine.iniciarBot(io, 'pairing', normalizePhone(req.body.phoneNumber || '')); res.json({ ok: true }); });
app.post('/api/session/clear', async (req, res) => { await botEngine.clearSession(io); res.json({ ok: true }); });

app.post('/api/config', (req, res) => {
  const { prefix, ownerName, ownerNumber, botName } = req.body;
  const updated = setConfig({
    ...(prefix ? { prefix: String(prefix).trim() } : {}),
    ...(ownerName ? { ownerName: String(ownerName).trim() } : {}),
    ...(ownerNumber ? { ownerNumber: normalizePhone(ownerNumber) } : {}),
    ...(botName ? { botName: String(botName).trim() } : {})
  });
  botEngine.emitState(io);
  return res.json({ ok: true, config: updated });
});

// --- COMANDOS E IA ---
app.get('/api/custom-cases', (req, res) => {
  let metadata = {};
  const metaPath = path.join(customDir, 'metadata.json');
  if (fs.existsSync(metaPath)) { try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch(e){} }
  const files = fs.readdirSync(customDir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
  res.json({ cases: files.map(name => ({ name, desc: metadata[name] || '' })) });
});

app.get('/api/custom-cases/:name', (req, res) => {
  const filePath = path.join(customDir, req.params.name + '.js');
  if (fs.existsSync(filePath)) res.json({ code: fs.readFileSync(filePath, 'utf8') });
  else res.status(404).json({ error: 'Não encontrado' });
});

app.post('/api/custom-cases/:name', (req, res) => {
  fs.writeFileSync(path.join(customDir, req.params.name + '.js'), req.body.code, 'utf8');
  res.json({ ok: true });
});

app.delete('/api/custom-cases/:name', (req, res) => {
  const filePath = path.join(customDir, req.params.name + '.js');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

app.post('/api/summarize-case', async (req, res) => {
  const { name } = req.body;
  const code = fs.readFileSync(path.join(customDir, name + '.js'), 'utf8');
  try {
    const bodyData = {
      model: "openai/gpt-oss-120b",
      temperature: 0.2,
      messages: [{ role: "system", content: "Analise o código e resuma o que o comando faz em no máximo 6 palavras. Retorne APENAS o resumo direto, sem markdown e sem aspas." }, { role: "user", content: code }]
    };
    const response = await fetch("https://" + "api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer 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`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });
    const data = await response.json();
    const summary = data.choices[0].message.content.trim();
    const metaPath = path.join(customDir, 'metadata.json');
    let metadata = {};
    if (fs.existsSync(metaPath)) { try { metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch(e){} }
    metadata[name] = summary;
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
    res.json({ ok: true, summary });
  } catch (e) { res.status(500).json({ error: 'IA falhou' }); }
});

app.post('/api/generate-case', async (req, res) => {
  const { prompt, currentCode } = req.body;
  try {
    const systemMsg = `Você é um Engenheiro de Software Sênior. REGRAS ABSOLUTAS: 1. Retorne APENAS o código JS puro. 2. SEM markdown. 3. SEM comentários. 4. SEM blocos switch/case (o arquivo já é o comando). 5. Estrutura obrigatória: module.exports = async ({ tokito, msg, command, args, q, reply, react, prefix, sender, isGroup }) => { <LÓGICA DIRETA> };`;
    const bodyData = {
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      messages: [{ role: "system", content: systemMsg }, { role: "user", content: currentCode ? `Código atual:\n${currentCode}\n\nAlteração pedida: ${prompt}` : prompt }]
    };
    const response = await fetch("https://" + "api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer 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`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });
    const data = await response.json();
    let code = data.choices[0].message.content.trim().replace(/^```[a-z]*\n?/im, '').replace(/```$/im, '').trim();
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ error: 'Erro IA.' }); }
});

io.on('connection', (socket) => {
  socket.emit('bot:state', { ...botEngine.webState, config: getConfig() });
  socket.emit('bot:logs', botEngine.webState.logs.slice(0, 50));
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Painel online em http://localhost:${PORT}`);
  const sessionDir = path.join(process.cwd(), 'qrcode');
  if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0) botEngine.iniciarBot(io);
});
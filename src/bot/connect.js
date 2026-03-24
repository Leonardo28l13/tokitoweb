const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion, 
  DisconnectReason,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const NodeCache = require("node-cache");
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode'); 
const { nowBR } = require('../lib/helpers');
const { getConfig } = require('../lib/db');

const sessionDir = path.join(process.cwd(), 'qrcode');
const msgRetryCounterCache = new NodeCache();
const useMobile = process.argv.includes("--mobile");

let tokito = null;

const webState = {
  status: 'offline', 
  connected: false,
  qr: null,
  pairingCode: null,
  logs: [],
  user: null
};

function addLog(io, message, type = 'info') {
  const log = { time: nowBR(), message, type };
  webState.logs.unshift(log); 
  if (webState.logs.length > 50) webState.logs.pop(); 
  if (io) io.emit('bot:log', log);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function emitState(io) {
  if (io) io.emit('bot:state', { ...webState, config: getConfig() });
}

async function clearSession(io) {
  if (tokito) {
    tokito.ev.removeAllListeners();
    tokito.end(new Error('Sessão apagada via painel web.'));
    tokito = null;
  }
  
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
  
  webState.status = 'offline';
  webState.connected = false;
  webState.qr = null;
  webState.pairingCode = null;
  webState.user = null;
  
  addLog(io, 'Sessão encerrada. Apagando pasta...', 'info');
  emitState(io);
}

async function iniciarBot(io, mode = 'qr', phoneNumber = '') {
  if (tokito) {
    addLog(io, 'O bot já está em execução.', 'info');
    return;
  }

  webState.status = 'connecting';
  emitState(io);
  addLog(io, 'Iniciando Baileys...', 'info');

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  tokito = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    mobile: useMobile,
    browser: ['Ubuntu','Chrome','20.0.04'],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: undefined,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false
  });

  if (!tokito.authState.creds.registered && mode === 'pairing' && phoneNumber) {
    webState.status = 'awaiting_pairing';
    emitState(io);
    
    setTimeout(async () => {
      try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
        const code = await tokito.requestPairingCode(cleanNumber);
        webState.pairingCode = code;
        addLog(io, `Código para conectar: ${code}`, 'success');
        emitState(io);
      } catch (error) {
        addLog(io, 'Falha ao solicitar o código.', 'error');
        console.error(error);
      }
    }, 3000); 
  }

  tokito.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !tokito.authState.creds.registered && mode === 'qr') {
      webState.status = 'awaiting_qr';
      try {
        webState.qr = await qrcode.toDataURL(qr); 
        addLog(io, 'QR Code gerado no painel.', 'info');
        emitState(io);
      } catch (err) {
        addLog(io, 'Erro ao renderizar o QR Code.', 'error');
      }
    }

    if (connection === 'open') {
      webState.status = 'online';
      webState.connected = true;
      webState.qr = null;
      webState.pairingCode = null;
      webState.user = { id: tokito.user.id, name: tokito.user.name || 'Bot' };
      
      addLog(io, '🧊 TOKITO-BASE CONECTADO!', 'success');
      emitState(io);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      webState.connected = false;

      if (reason === DisconnectReason.loggedOut) {
        addLog(io, 'Sessão encerrada pelo celular. Apagando pasta...', 'error');
        await clearSession(io);
      } else {
        addLog(io, 'Reconectando...', 'error');
        webState.status = 'connecting';
        emitState(io);
        tokito = null;
        setTimeout(() => iniciarBot(io, mode, phoneNumber), 3000);
      }
    }
  });

  tokito.ev.on('creds.update', saveCreds);

  
  tokito.ev.on('messages.upsert', async (m) => {
    try {
      const caminhoIndex = require.resolve('./index');
      delete require.cache[caminhoIndex]; 
      const handlerDinamico = require(caminhoIndex); 
      await handlerDinamico(tokito, m);
    } catch (err) {
      console.log("Erro no handler:", err);
    }
  });
}

module.exports = { webState, iniciarBot, clearSession, emitState };

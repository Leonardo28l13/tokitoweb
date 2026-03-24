const fs = require('fs');
const path = require('path');
const P = require('pino');
const chalk = require('chalk');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const { getConfig, getGroups, saveGroups, getUsers, saveUsers, setConfig } = require('../lib/db');
const { nowBR, formatRuntime, isLink, normalizePhone, levelFromXp } = require('../lib/helpers');

class BotManager {
  constructor(io) {
    this.io = io;
    this.sock = null;
    this.qr = null;
    this.pairingCode = null;
    this.status = 'offline';
    this.logs = [];
    this.authDir = path.join(process.cwd(), 'sessions', 'main');
    this.connecting = false;
    this.lastMode = 'qr';
    this.lastPhoneNumber = '';
    this.pairingRequested = false;
    this.reconnectTimer = null;
  }

  pushLog(message, type = 'info') {
    const line = { time: nowBR(), message, type };
    this.logs.unshift(line);
    this.logs = this.logs.slice(0, 150);
    const color = type === 'error' ? chalk.red : type === 'success' ? chalk.green : type === 'warn' ? chalk.yellow : chalk.cyan;
    console.log(color(`[${line.time}] ${message}`));
    this.io.emit('bot:log', line);
  }

  emitState(extra = {}) {
    const config = getConfig();
    this.io.emit('bot:state', {
      connected: !!this.sock?.user,
      status: this.status,
      qr: this.qr,
      pairingCode: this.pairingCode,
      user: this.sock?.user || null,
      config,
      uptime: formatRuntime(process.uptime()),
      ...extra
    });
  }

  getGroupSettings(groupId) {
    const groups = getGroups();
    if (!groups[groupId]) {
      groups[groupId] = {
        welcome: false,
        antilink: false,
        prefix: null
      };
      saveGroups(groups);
    }
    return groups[groupId];
  }

  setGroupSettings(groupId, patch) {
    const groups = getGroups();
    groups[groupId] = { ...(groups[groupId] || { welcome: false, antilink: false, prefix: null }), ...patch };
    saveGroups(groups);
    return groups[groupId];
  }

  getUserData(userId) {
    const users = getUsers();
    if (!users[userId]) {
      users[userId] = { xp: 0, level: 1, messages: 0 };
      saveUsers(users);
    }
    return users[userId];
  }

  addXp(userId, amount = 10) {
    const users = getUsers();
    const user = users[userId] || { xp: 0, level: 1, messages: 0 };
    user.xp += amount;
    user.messages += 1;
    user.level = levelFromXp(user.xp);
    users[userId] = user;
    saveUsers(users);
    return user;
  }

  isSessionError(error) {
    const text = String(error?.message || error || '');
    return /No sessions|SessionError|Cannot read properties of undefined.*trace/i.test(text);
  }

  scheduleReconnect(delay = 4000) {
    if (this.reconnectTimer) return;
    this.pushLog('Reconexão automática agendada...', 'warn');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect({ mode: this.lastMode, phoneNumber: this.lastPhoneNumber });
    }, delay);
  }

  async clearSession() {
    try {
      if (this.sock?.ws) {
        try { this.sock.end?.(new Error('Sessão reiniciada manualmente')); } catch {}
        try { this.sock.ws.close(); } catch {}
      }
      if (fs.existsSync(path.dirname(this.authDir))) {
        fs.rmSync(path.dirname(this.authDir), { recursive: true, force: true });
      }
    } catch (err) {
      this.pushLog(`Erro ao limpar sessão: ${err.message}`, 'error');
    }
    this.sock = null;
    this.qr = null;
    this.pairingCode = null;
    this.pairingRequested = false;
    this.status = 'offline';
    this.emitState();
    this.pushLog('Sessão apagada com sucesso.', 'success');
  }

  async connect({ mode = 'qr', phoneNumber = '' } = {}) {
    if (this.connecting) {
      this.pushLog('Já existe uma conexão em andamento.', 'warn');
      return;
    }

    if (this.sock?.user && this.status === 'online') {
      this.pushLog('O bot já está online.', 'warn');
      return;
    }

    this.connecting = true;
    this.lastMode = mode;
    this.lastPhoneNumber = phoneNumber;
    this.pairingRequested = false;
    this.status = 'connecting';
    this.qr = null;
    this.pairingCode = null;
    this.emitState();
    this.pushLog(`Iniciando conexão via ${mode === 'pairing' ? 'número' : 'QR Code'}...`);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        browser: Browsers.macOS('Tokito Web Bot'),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 60000,
        generateHighQualityLinkPreview: true,
        emitOwnEvents: false,
        retryRequestDelayMs: 300,
        keepAliveIntervalMs: 20000
      });

      this.sock = sock;

      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (err) {
          this.pushLog(`Erro ao salvar credenciais: ${err.message}`, 'error');
        }
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr && mode === 'qr') {
          this.qr = await QRCode.toDataURL(qr);
          this.status = 'awaiting_qr';
          this.emitState();
          this.pushLog('QR Code gerado. Escaneie no site.', 'success');
        }

        if (
          mode === 'pairing' &&
          phoneNumber &&
          !sock.authState.creds.registered &&
          !this.pairingRequested
        ) {
          this.pairingRequested = true;
          try {
            const clean = normalizePhone(phoneNumber);
            const code = await sock.requestPairingCode(clean);
            this.pairingCode = code;
            this.status = 'awaiting_pairing';
            this.emitState();
            this.pushLog(`Código de pareamento gerado para ${clean}.`, 'success');
          } catch (err) {
            this.pairingRequested = false;
            this.pushLog(`Erro ao gerar código de pareamento: ${err.message}`, 'error');
          }
        }

        if (connection === 'open') {
          this.status = 'online';
          this.qr = null;
          this.pairingCode = null;
          this.emitState();
          this.pushLog(`Bot conectado como ${sock.user?.name || sock.user?.id}.`, 'success');
        }

        if (connection === 'close') {
          const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = code !== DisconnectReason.loggedOut;
          this.status = 'offline';
          this.emitState();

          if (this.isSessionError(lastDisconnect?.error)) {
            this.pushLog('Sessão Signal inválida detectada. O bot vai tentar reconectar sozinho.', 'warn');
          } else {
            this.pushLog(`Conexão encerrada${code ? ` (código ${code})` : ''}.`, code === DisconnectReason.loggedOut ? 'error' : 'warn');
          }

          if (shouldReconnect) {
            this.scheduleReconnect(4000);
          } else {
            this.pushLog('Sessão desconectada. Limpe a sessão e conecte novamente.', 'error');
          }
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages?.[0];
        if (!msg?.message || msg.key?.fromMe) return;

        try {
          await this.handleMessage(msg);
        } catch (err) {
          if (this.isSessionError(err)) {
            this.pushLog('Erro de sessão ao processar mensagem. Ignorando este evento para não derrubar o bot.', 'warn');
            return;
          }
          this.pushLog(`Erro ao processar mensagem: ${err.message}`, 'error');
        }
      });

      sock.ev.on('group-participants.update', async (update) => {
        try {
          const settings = this.getGroupSettings(update.id);
          if (!settings.welcome) return;
          const metadata = await sock.groupMetadata(update.id);
          for (const participant of update.participants) {
            if (update.action === 'add') {
              await sock.sendMessage(update.id, {
                text: `╭─❍\n│ 👋 *Bem-vindo(a)!*\n│\n│ @${participant.split('@')[0]} entrou em *${metadata.subject}*\n│ Curta o grupo e respeite as regras ✨\n╰─❍`,
                mentions: [participant]
              });
            } else if (update.action === 'remove') {
              await sock.sendMessage(update.id, {
                text: `╭─❍\n│ 😢 *@${participant.split('@')[0]}* saiu do grupo\n│ Volte sempre ✨\n╰─❍`,
                mentions: [participant]
              });
            }
          }
        } catch (err) {
          this.pushLog(`Erro no sistema de boas-vindas: ${err.message}`, 'error');
        }
      });
    } catch (err) {
      this.pushLog(`Erro ao conectar: ${err.message}`, 'error');
      this.status = 'offline';
      this.emitState();
      this.scheduleReconnect(5000);
    } finally {
      this.connecting = false;
    }
  }

  async handleMessage(msg) {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    const isGroup = jid.endsWith('@g.us');
    const sender = isGroup ? (msg.key.participant || '') : jid;
    if (!sender) return;

    const text = this.getText(msg.message).trim();
    if (!text) return;

    const config = getConfig();
    const groupSettings = isGroup ? this.getGroupSettings(jid) : null;
    const prefix = groupSettings?.prefix || config.prefix;

    if (isGroup && groupSettings?.antilink && isLink(text)) {
      try {
        await this.sock.sendMessage(jid, {
          text: `🚫 @${sender.split('@')[0]}, links não são permitidos aqui.`,
          mentions: [sender]
        }, { quoted: msg });
        await this.sock.groupParticipantsUpdate(jid, [sender], 'remove');
        return;
      } catch (err) {
        this.pushLog(`Erro no anti-link: ${err.message}`, 'error');
      }
    }

    const user = this.addXp(sender, 8);

    if (!text.startsWith(prefix)) return;

    const args = text.slice(prefix.length).trim().split(/\s+/);
    const command = (args.shift() || '').toLowerCase();
    const q = args.join(' ');

    const reply = async (content, extra = {}) => this.sock.sendMessage(jid, { text: content, ...extra }, { quoted: msg });
    const react = async (emoji) => {
      try {
        await this.sock.sendMessage(jid, { react: { text: emoji, key: msg.key } });
      } catch {}
    };

    switch (command) {
      case 'menu':
      case 'help':
        await react('🧊');
        return reply([
          `╭─❍ *${config.botName}*`,
          `│ Dono: ${config.ownerName}`,
          `│ Prefixo: ${prefix}`,
          `│ Hora: ${nowBR()}`,
          `╰─❍`,
          '',
          '✦ *Comandos*',
          `${prefix}ping`,
          `${prefix}owner`,
          `${prefix}perfil`,
          `${prefix}nivel`,
          `${prefix}rank`,
          `${prefix}grupo`,
          `${prefix}admins`,
          `${prefix}id`,
          `${prefix}uptime`,
          `${prefix}marcar texto`,
          `${prefix}hidetag texto`,
          `${prefix}say texto`,
          `${prefix}welcome on/off`,
          `${prefix}antilink on/off`,
          `${prefix}setprefix novo`,
          `${prefix}botinfo`
        ].join('\n'));

      case 'ping':
        await react('🏓');
        return reply(`🏓 Pong\n⏰ ${nowBR()}\n⚡ Online e funcionando.`);

      case 'owner':
        return reply(`👑 Dono: ${config.ownerName}\n📞 Número: ${config.ownerNumber}`);

      case 'perfil':
        return reply(`👤 @${sender.split('@')[0]}\n⭐ XP: ${user.xp}\n📈 Level: ${user.level}\n💬 Mensagens: ${user.messages}`, { mentions: [sender] });

      case 'nivel':
      case 'level':
        return this.sock.sendMessage(jid, {
          text: `🧊 *Seu nível*\n\n👤 @${sender.split('@')[0]}\n⭐ XP: ${user.xp}\n📈 Level: ${user.level}\n💬 Mensagens: ${user.messages}`,
          mentions: [sender]
        }, { quoted: msg });

      case 'rank': {
        const users = getUsers();
        const ids = Object.keys(users)
          .sort((a, b) => (users[b]?.xp || 0) - (users[a]?.xp || 0))
          .slice(0, 10);
        const ranking = ids
          .map((id, i) => `${i + 1}. @${id.split('@')[0]} — ${users[id].xp} XP`)
          .join('\n');
        return this.sock.sendMessage(jid, {
          text: `🏆 *Top 10 ranking*\n\n${ranking || 'Sem dados ainda.'}`,
          mentions: ids
        }, { quoted: msg });
      }

      case 'grupo':
        if (!isGroup) return reply('❌ Esse comando só funciona em grupo.');
        try {
          const metadata = await this.sock.groupMetadata(jid);
          return reply(`👥 Grupo: ${metadata.subject}\n👤 Membros: ${metadata.participants.length}\n🆔 ID: ${jid}`);
        } catch {
          return reply('❌ Não consegui ler os dados do grupo.');
        }

      case 'admins':
        if (!isGroup) return reply('❌ Esse comando só funciona em grupo.');
        try {
          const metadata = await this.sock.groupMetadata(jid);
          const admins = metadata.participants.filter((p) => p.admin).map((p) => p.id);
          if (!admins.length) return reply('❌ Não encontrei admins nesse grupo.');
          return this.sock.sendMessage(jid, {
            text: `👑 *Admins do grupo*\n\n${admins.map((id) => `• @${id.split('@')[0]}`).join('\n')}`,
            mentions: admins
          }, { quoted: msg });
        } catch {
          return reply('❌ Não consegui listar os admins.');
        }

      case 'id':
        if (isGroup) return reply(`🆔 ID do grupo: ${jid}`);
        return reply(`🆔 Seu ID: ${sender}`);

      case 'uptime':
        return reply(`⏳ Uptime: ${formatRuntime(process.uptime())}`);

      case 'say':
        if (!q) return reply(`Use: ${prefix}say texto`);
        return reply(q);

      case 'marcar':
      case 'hidetag':
      case 'tagall':
        if (!isGroup) return reply('❌ Esse comando só funciona em grupo.');
        try {
          const metadata = await this.sock.groupMetadata(jid);
          const mentions = metadata.participants.map((p) => p.id);
          return this.sock.sendMessage(jid, {
            text: q || '📢 Marcando todos do grupo.',
            mentions
          }, { quoted: msg });
        } catch {
          return reply('❌ Não consegui marcar o grupo.');
        }

      case 'welcome':
        if (!isGroup) return reply('❌ Esse comando só funciona em grupo.');
        if (!['on', 'off'].includes((args[0] || '').toLowerCase())) return reply(`Use: ${prefix}welcome on/off`);
        this.setGroupSettings(jid, { welcome: args[0].toLowerCase() === 'on' });
        return reply(`✅ Welcome ${args[0].toLowerCase() === 'on' ? 'ativado' : 'desativado'}.`);

      case 'antilink':
        if (!isGroup) return reply('❌ Esse comando só funciona em grupo.');
        if (!['on', 'off'].includes((args[0] || '').toLowerCase())) return reply(`Use: ${prefix}antilink on/off`);
        this.setGroupSettings(jid, { antilink: args[0].toLowerCase() === 'on' });
        return reply(`✅ Anti-link ${args[0].toLowerCase() === 'on' ? 'ativado' : 'desativado'}.`);

      case 'setprefix':
        if (!q) return reply(`Use: ${prefix}setprefix novo_prefixo`);
        if (isGroup) {
          this.setGroupSettings(jid, { prefix: q.trim() });
          return reply(`✅ Prefixo do grupo alterado para: ${q.trim()}`);
        }
        setConfig({ prefix: q.trim() });
        this.emitState();
        return reply(`✅ Prefixo global alterado para: ${q.trim()}`);

      case 'botinfo':
        return reply(`🤖 ${config.botName}\n👑 ${config.ownerName}\n⏳ Uptime: ${formatRuntime(process.uptime())}\n📶 Status: ${this.status}`);

      default:
        return reply(`❌ Comando não encontrado. Use ${prefix}menu`);
    }
  }

  getText(message = {}) {
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.buttonsResponseMessage?.selectedButtonId) return message.buttonsResponseMessage.selectedButtonId;
    if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return message.listResponseMessage.singleSelectReply.selectedRowId;
    return '';
  }
}

module.exports = BotManager;

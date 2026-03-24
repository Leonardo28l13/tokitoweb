const { getConfig, setConfig, getUsers, saveUsers, getGroups, saveGroups } = require('../lib/db');
const { levelFromXp, formatRuntime, nowBR, isLink } = require('../lib/helpers');
const colors = require('colors');
const fs = require('fs');
const path = require('path');

const startupTime = Math.floor(Date.now() / 1000);

function getGroupSettings(groupId) {
  const groups = getGroups();
  if (!groups[groupId]) {
    groups[groupId] = { welcome: false, antilink: false, prefix: null, banned: false };
    saveGroups(groups);
  }
  return groups[groupId];
}

function setGroupSettings(groupId, patch) {
  const groups = getGroups();
  groups[groupId] = { ...(groups[groupId] || { welcome: false, antilink: false, prefix: null, banned: false }), ...patch };
  saveGroups(groups);
  return groups[groupId];
}

function addXp(userId, amount = 10) {
  const users = getUsers();
  const user = users[userId] || { xp: 0, level: 1, messages: 0 };
  user.xp += amount;
  user.messages += 1;
  user.level = levelFromXp(user.xp);
  users[userId] = user;
  saveUsers(users);
  return user;
}

module.exports = async (tokito, m) => {
  try {
    const msg = m.messages?.[0];
    if (!msg) return;

    if (m.type !== 'notify') return;
    if (msg.messageTimestamp < startupTime) return;

    const message = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
    if (!message) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const sender = isGroup ? msg.key.participant : from;
    const API_KEY_TOKITO = "TOKITO-BASE-WEB"; 
    
    const body = message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || message.buttonsResponseMessage?.selectedButtonId || message.listResponseMessage?.singleSelectReply?.selectedRowId || "";

    if (body) {
      console.log(colors.cyan("💬 [MENSAGEM]") + colors.gray(` De: ${sender.split('@')[0]} | `) + colors.white(`Texto: "${body}"`));
    }

    const config = getConfig();
    const groupSettings = isGroup ? getGroupSettings(from) : null;
    const prefix = groupSettings?.prefix || config.prefix || "!";

    if (isGroup && groupSettings?.antilink && !groupSettings?.banned && isLink(body)) {
      try {
        await tokito.sendMessage(from, { text: `🚫 @${sender.split('@')[0]}, links não permitidos!`, mentions: [sender] }, { quoted: msg });
        await tokito.groupParticipantsUpdate(from, [sender], 'remove');
        return; 
      } catch (err) {
        console.log(colors.red("❌ [ERRO NO ANTI-LINK]"), err);
      }
    }

    let user;
    if (!groupSettings?.banned) {
        user = addXp(sender, 8);
    }

    if (!body.startsWith(prefix)) return;

    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();
    const q = args.join(" ");
    
    if (isGroup && groupSettings?.banned && command !== 'unbangp') return; 

    console.log(colors.green("⚙️ [COMANDO]") + colors.gray(` Detetado: `) + colors.white(`${prefix}${command}`));

    const reply = async (texto, extras = {}) => tokito.sendMessage(from, { text: texto, ...extras }, { quoted: msg });
    const react = async (emoji) => {
      try { await tokito.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch {}
    };

    switch (command) {
      
      case 'menu':
      case 'help': {
        await react('🧊');
        const menuText = `
╭─❍ *${config.botName || 'Tokito Bot'}*
│ 👋 Olá, @${sender.split('@')[0]}!
│ 👑 Dono: ${config.ownerName || 'Dono'}
│ ⚙️ Prefixo: [ ${prefix} ]
╰─❍

✦ *COMANDOS BÁSICOS* ✦
❯ ${prefix}ping
❯ ${prefix}owner
❯ ${prefix}perfil
❯ ${prefix}rank
❯ ${prefix}play_audio [música]

✦ *GRUPO & ADMIN* ✦
❯ ${prefix}grupo
❯ ${prefix}admins
❯ ${prefix}marcar [texto]
❯ ${prefix}hidetag [texto]
❯ ${prefix}welcome [on/off]
❯ ${prefix}antilink [on/off]
❯ ${prefix}setprefix [novo]
❯ ${prefix}bangp
❯ ${prefix}unbangp

✦ *UTILITÁRIOS* ✦
❯ ${prefix}id
❯ ${prefix}uptime
❯ ${prefix}botinfo
❯ ${prefix}say [texto]
        `.trim();
        return reply(menuText, { mentions: [sender] });
      }

      case 'bangp':
        if (!isGroup) return reply('❌ Este comando só funciona em grupos.');
        setGroupSettings(from, { banned: true });
        return reply(`🚫 *GRUPO BANIDO* 🚫\nBot desativado aqui. Reative com *${prefix}unbangp*.`);

      case 'unbangp':
        if (!isGroup) return reply('❌ Este comando só funciona em grupos.');
        setGroupSettings(from, { banned: false });
        return reply('✅ *GRUPO DESBANIDO*');

      

      case 'owner':
        return reply(`👑 Dono: ${config.ownerName || 'Dono'}\n📞 Número: wa.me/${config.ownerNumber || ''}`);

      case 'perfil':
      case 'nivel':
      case 'level':
        if(!user) return;
        return reply(`🧊 *Seu Perfil*\n\n👤 @${sender.split('@')[0]}\n⭐ XP: ${user.xp}\n📈 Nível: ${user.level}\n💬 Mensagens: ${user.messages}`, { mentions: [sender] });

      case 'rank': {
        const users = getUsers();
        const ids = Object.keys(users).sort((a, b) => (users[b]?.xp || 0) - (users[a]?.xp || 0)).slice(0, 10);
        const ranking = ids.map((id, i) => `${i + 1}. @${id.split('@')[0]} — ${users[id].xp} XP`).join('\n');
        return reply(`🏆 *Top 10 Ranking de XP*\n\n${ranking || 'Sem dados ainda.'}`, { mentions: ids });
      }

      case 'grupo':
        if (!isGroup) return reply('❌ Este comando só funciona em grupos.');
        try {
          const metadata = await tokito.groupMetadata(from);
          return reply(`👥 Grupo: ${metadata.subject}\n👤 Membros: ${metadata.participants.length}\n🆔 ID: ${from}`);
        } catch {
          return reply('❌ Erro ao ler dados do grupo.');
        }

      case 'admins':
        if (!isGroup) return reply('❌ Apenas grupos.');
        try {
          const metadata = await tokito.groupMetadata(from);
          const admins = metadata.participants.filter((p) => p.admin).map((p) => p.id);
          return reply(`👑 *Admins*\n\n${admins.map((id) => `• @${id.split('@')[0]}`).join('\n')}`, { mentions: admins });
        } catch {
          return reply('❌ Erro.');
        }

      case 'id': return reply(`🆔 ID: ${isGroup ? from : sender}`);
      case 'uptime': return reply(`⏳ Uptime: ${formatRuntime(process.uptime())}`);
      case 'botinfo': return reply(`🤖 ${config.botName}\n👑 ${config.ownerName}`);
      case 'say': return reply(q || `Uso: ${prefix}say texto`);

      case 'marcar':
      case 'tagall':
        if (!isGroup) return reply('❌ Apenas grupos.');
        try {
          const metadata = await tokito.groupMetadata(from);
          const mentions = metadata.participants.map((p) => p.id);
          return reply(q || '📢 A chamar todos!', { mentions });
        } catch { return reply('❌ Erro ao marcar.'); }
        
      case 'hidetag':
        if (!isGroup) return reply('❌ Apenas grupos.');
        try {
          const metadata = await tokito.groupMetadata(from);
          const mentions = metadata.participants.map((p) => p.id);
          return tokito.sendMessage(from, { text: q || '📢 Atenção!', mentions });
        } catch { return reply('❌ Erro.'); }

      case 'welcome':
        if (!isGroup) return reply('❌ Apenas grupos.');
        if (!['on', 'off'].includes((args[0] || '').toLowerCase())) return reply(`Uso: ${prefix}welcome on/off`);
        setGroupSettings(from, { welcome: args[0].toLowerCase() === 'on' });
        return reply(`✅ Boas-vindas ${args[0].toLowerCase() === 'on' ? 'ativado' : 'desativado'}.`);

      case 'antilink':
        if (!isGroup) return reply('❌ Apenas grupos.');
        if (!['on', 'off'].includes((args[0] || '').toLowerCase())) return reply(`Uso: ${prefix}antilink on/off`);
        setGroupSettings(from, { antilink: args[0].toLowerCase() === 'on' });
        return reply(`✅ Anti-link ${args[0].toLowerCase() === 'on' ? 'ativado' : 'desativado'}.`);

      case 'setprefix':
        if (!q) return reply(`Uso: ${prefix}setprefix novo_prefixo`);
        if (isGroup) {
          setGroupSettings(from, { prefix: q.trim() });
          return reply(`✅ Prefixo do grupo alterado para: [ ${q.trim()} ]`);
        }
        setConfig({ prefix: q.trim() });
        return reply(`✅ Prefixo global alterado para: [ ${q.trim()} ]`);

      case "play_audio":
      case "playaudio":
      case "ytaudio": {
        if (!q) return reply(`Exemplo: ${prefix}play_audio linkin park`);
        try {
          const apiUrl = `https://tokito-apis.site/api/youtube-audio?q=${encodeURIComponent(q)}&apikey=${API_KEY_TOKITO}`;
          await tokito.sendMessage(from, { audio: { url: apiUrl }, mimetype: "audio/mpeg" }, { quoted: msg });
        } catch (e) {
          return reply("❌ Ocorreu um erro ao transferir o áudio.");
        }
        break;
      }
      
      case "teste": {
        const emojis = ['✅', '🚀', '🔥', '👀', '🤖', '👾', '✨', '🥶', '😎', '👻', '🎲', '🎯'];
        await react(emojis[Math.floor(Math.random() * emojis.length)]);
        return reply("testado");
      }
      
      // 🔥 O CÉREBRO QUE LÊ AS SUAS CASES INDIVIDUAIS 🔥
      default: 
        try {
          const casePath = path.join(__dirname, 'custom', `${command}.js`);
          
          if (fs.existsSync(casePath)) {
            // Limpa o cache para ter o Hot Reload perfeito
            delete require.cache[require.resolve(casePath)];
            const executeCustomCase = require(casePath);
            
            // Roda a case injetando todas as funções do bot
            await executeCustomCase({ tokito, msg, command, args, q, reply, react, prefix, sender, isGroup });
          }
        } catch (err) {
          console.log(colors.yellow(`⚠️ [ERRO NA CASE !${command}]:`), err.message);
        }
        break;
    }
  } catch (err) {
    console.log(colors.red("❌ [ERRO NO HANDLER]"), err);
  }
};
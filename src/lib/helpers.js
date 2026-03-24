const moment = require('moment-timezone');

function nowBR() {
  return moment().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');
}

function formatRuntime(seconds) {
  seconds = Number(seconds || 0);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

function isLink(text = '') {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/)/i.test(text);
}

function normalizePhone(phone = '') {
  return phone.replace(/\D/g, '');
}

function levelFromXp(xp = 0) {
  return Math.floor(xp / 100) + 1;
}

module.exports = {
  nowBR,
  formatRuntime,
  isLink,
  normalizePhone,
  levelFromXp
};

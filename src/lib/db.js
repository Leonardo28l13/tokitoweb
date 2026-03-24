const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(process.cwd(), 'database');
const FILES = {
  config: path.join(DB_DIR, 'config.json'),
  groups: path.join(DB_DIR, 'groups.json'),
  users: path.join(DB_DIR, 'users.json')
};

const defaults = {
  config: {
    prefix: '!',
    ownerNumber: '5591999999999',
    botName: 'Tokito Web Bot',
    ownerName: 'dylan Modz'
  },
  groups: {},
  users: {}
};

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function ensureFile(file, data) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
}

function initDB() {
  ensureDir();
  for (const [key, file] of Object.entries(FILES)) {
    ensureFile(file, defaults[key]);
  }
}

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getConfig() {
  return readJSON(FILES.config, defaults.config);
}

function setConfig(nextConfig) {
  writeJSON(FILES.config, { ...getConfig(), ...nextConfig });
  return getConfig();
}

function getGroups() {
  return readJSON(FILES.groups, defaults.groups);
}

function saveGroups(groups) {
  writeJSON(FILES.groups, groups);
}

function getUsers() {
  return readJSON(FILES.users, defaults.users);
}

function saveUsers(users) {
  writeJSON(FILES.users, users);
}

module.exports = {
  initDB,
  getConfig,
  setConfig,
  getGroups,
  saveGroups,
  getUsers,
  saveUsers,
  FILES,
  DB_DIR
};

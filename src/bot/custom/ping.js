module.exports = async ({ tokito, msg, command, args, q, reply, react, prefix, sender, isGroup }) => {
const os = require('os')
await react('⚙️')
const totalMem = os.totalmem()
const freeMem = os.freemem()
const usedMem = totalMem - freeMem
const memUsage = ((usedMem/totalMem)*100).toFixed(2)
const cpus = os.cpus()
const cpuModel = cpus.length?cpus[0].model:'Desconhecido'
const cpuCores = cpus.length
const load = os.loadavg()[0].toFixed(2)
const usedGB = (usedMem/(1024**3)).toFixed(2)
const totalGB = (totalMem/(1024**3)).toFixed(2)
const uptimeMin = Math.floor(os.uptime()/60)
const info = `✨ *${tokito}* - Status do Sistema ✨
🖥️ CPU: ${cpuModel}
🧮 Cores: ${cpuCores}
📈 Load (1m): ${load}
💾 RAM: ${usedGB} GB / ${totalGB} GB (${memUsage}%)
🕒 Uptime: ${uptimeMin} min`
await reply(info)
}
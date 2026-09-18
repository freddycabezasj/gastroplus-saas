// Copias de seguridad de la base SQLite. Usa el API de respaldo en caliente
// de better-sqlite3 (seguro con el servidor corriendo y escribiendo a la vez).
// Uso:
//   node server/backup.js          -> genera una copia con fecha/hora
//   require('./backup').schedule() -> lo llama server/index.js automáticamente
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP_LAST = Number(process.env.BACKUP_KEEP || 14); // cuántas copias conservar

function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, 'gastroplus-' + stamp + '.db');
  db.backup(dest)
    .then(() => {
      console.log('[backup] copia creada: ' + dest);
      pruneOldBackups();
    })
    .catch((err) => console.error('[backup] falló la copia:', err.message));
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('gastroplus-') && f.endsWith('.db'))
    .sort(); // los nombres son ISO -> orden cronológico
  while (files.length > KEEP_LAST) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    console.log('[backup] copia antigua eliminada: ' + oldest);
  }
}

// Corre dentro del propio proceso del servidor: una copia al arrancar y
// luego cada 24h. Es un respaldo "de cortesía" para hostings sin cron propio;
// si tu hosting sí ofrece cron, es más confiable llamar a este script desde
// ahí (ver README) en vez de depender de que el proceso nunca se reinicie.
function schedule() {
  runBackup();
  setInterval(runBackup, 24 * 60 * 60 * 1000);
}

module.exports = { runBackup, schedule };

if (require.main === module) runBackup();

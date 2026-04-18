require('dotenv').config();
const { logger } = require('./lib/logger');

const config = require('./lib/config').get();
if (config.errors.length) {
  for (const e of config.errors) logger.error(e);
  process.exit(1);
}

const { createServer } = require('./lib/server');
const { flushAll } = require('./lib/store');
const { getInflight } = require('./core/dispatcher');
const { startInboundListener, stopInboundListener } = require('./platforms/email/inbound');

logger.info('starting', {
  version: require('./package.json').version,
  port: config.port,
  timeoutMs: config.agentTimeoutMs,
  logLevel: config.logLevel,
  dashboardAuth: !!config.dashboardToken,
  permissionMode: config.permissionMode,
});

const inflight = getInflight();
let currentBot = null;

function startTelegramBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.botToken) {
    logger.warn('Telegram bot token not configured — open the dashboard Settings tab to configure it');
    return;
  }
  const { createBot, COMMANDS } = require('./platforms/telegram');
  const { bot } = createBot();
  currentBot = bot;

  bot.telegram
    .setMyCommands(COMMANDS)
    .then(() => logger.info('command menu registered', { count: COMMANDS.length }))
    .catch((err) => logger.warn('setMyCommands failed', { err: err.message }));

  bot.launch().catch((err) => {
    logger.error('bot launch failed', { err: err.message });
    currentBot = null;
  });
  logger.info('telegram polling started');
}

function stopTelegramBot(reason) {
  if (currentBot) {
    try { currentBot.stop(reason); } catch {}
    currentBot = null;
  }
}

function restartTelegramBot() {
  logger.info('restarting telegram bot with new settings');
  stopTelegramBot('restart');
  require('./lib/config').reload();
  startTelegramBot();
}

startTelegramBot();

const server = createServer({
  getStatus: () => ({ inflightChats: inflight.size, botRunning: !!currentBot }),
  restartBot: restartTelegramBot,
}).listen(config.port, () => {
  logger.info('dashboard listening', { url: `http://localhost:${config.port}` });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} in use — another instance is likely running.`);
    process.exit(1);
  }
  throw err;
});

// Delay IMAP start slightly so DNS resolves cleanly after process startup
setTimeout(startInboundListener, 3000);

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { reason });
  for (const ac of inflight.values()) ac.abort();
  stopTelegramBot(reason);
  server.close();
  stopInboundListener().catch(() => {});
  try { flushAll(); } catch (err) { logger.warn('flush failed', { err: err.message }); }
  setTimeout(() => process.exit(0), 800).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) =>
  logger.error('uncaught', { err: err.message, stack: err.stack }),
);
process.on('unhandledRejection', (err) =>
  logger.error('unhandledRejection', { err: String(err) }),
);

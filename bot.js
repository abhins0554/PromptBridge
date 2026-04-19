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
let currentTelegramBot = null;
let currentDiscordBot = null;
let currentSlackApp = null;

function startTelegramBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.botToken) {
    logger.warn('Telegram bot token not configured — open the dashboard Settings tab to configure it');
    return;
  }
  const { createBot, COMMANDS } = require('./platforms/telegram');
  const { bot } = createBot();
  currentTelegramBot = bot;

  bot.telegram
    .setMyCommands(COMMANDS)
    .then(() => logger.info('command menu registered', { count: COMMANDS.length }))
    .catch((err) => logger.warn('setMyCommands failed', { err: err.message }));

  bot.launch().catch((err) => {
    logger.error('bot launch failed', { err: err.message });
    currentTelegramBot = null;
  });
  logger.info('telegram polling started');
}

function stopTelegramBot(reason) {
  if (currentTelegramBot) {
    try { currentTelegramBot.stop(reason); } catch {}
    currentTelegramBot = null;
  }
}

function startDiscordBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.discord?.botToken) {
    logger.warn('Discord bot token not configured — open the dashboard Settings tab to configure it');
    return;
  }
  const { createBot } = require('./platforms/discord');
  const { client } = createBot();
  currentDiscordBot = client;

  client.login(cfg.discord.botToken).catch((err) => {
    logger.error('discord login failed', { err: err.message });
    currentDiscordBot = null;
  });
  logger.info('discord client starting');
}

function stopDiscordBot() {
  if (currentDiscordBot) {
    try { currentDiscordBot.destroy(); } catch {}
    currentDiscordBot = null;
  }
}

function startSlackBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.slack?.botToken || !cfg.slack?.appToken) {
    logger.warn('Slack tokens not configured — open the dashboard Settings tab to configure them');
    return;
  }
  const { createBot } = require('./platforms/slack');
  const { app } = createBot();
  currentSlackApp = app;

  app.start().catch((err) => {
    logger.error('slack app start failed', { err: err.message });
    currentSlackApp = null;
  });
  logger.info('slack socket mode starting');
}

function stopSlackBot() {
  if (currentSlackApp) {
    try { currentSlackApp.stop(); } catch {}
    currentSlackApp = null;
  }
}

function restartPlatforms() {
  logger.info('restarting chat platforms with new settings');
  stopTelegramBot('restart');
  stopDiscordBot();
  stopSlackBot();
  require('./lib/config').reload();
  startTelegramBot();
  startDiscordBot();
  startSlackBot();
}

startTelegramBot();
startDiscordBot();
startSlackBot();

const server = createServer({
  getStatus: () => ({
    inflightChats: inflight.size,
    botRunning: !!currentTelegramBot,
    discordRunning: !!currentDiscordBot,
    slackRunning: !!currentSlackApp,
  }),
  restartPlatforms,
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
  stopDiscordBot();
  stopSlackBot();
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

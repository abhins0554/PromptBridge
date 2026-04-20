require('dotenv').config();
const { logger } = require('./lib/logger');

// Lazy-load GitHub polling
let githubPollingModule = null;
function getGitHubPolling() {
  if (!githubPollingModule) {
    try {
      githubPollingModule = require('./platforms/github/polling');
    } catch (err) {
      logger.warn('GitHub polling not available', { err: err.message });
      return { startPolling: () => {}, stopPolling: () => {} };
    }
  }
  return githubPollingModule;
}

let config = require('./lib/config').get();
if (config.errors.length) {
  for (const e of config.errors) logger.error(e);
  process.exit(1);
}

const { createServer } = require('./lib/server');
const { flushAll } = require('./lib/store');
const { getInflight } = require('./core/dispatcher');
const { startInboundListener, stopInboundListener } = require('./platforms/email/inbound');

const inflight = getInflight();
let currentTelegramBot = null;
let currentDiscordBot = null;
let currentSlackApp = null;
let currentTeamsAdapter = null;
let currentTeamsExpress = null;
let server = null;
let emailInboundStarted = false;
let githubPollingStarted = false;
let shuttingDown = false;

const platformStatus = {
  telegram: false,
  discord: false,
  slack: false,
  teams: false,
  email: false,
  github: false,
};

function startTelegramBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.botToken) {
    logger.warn('Telegram bot token not configured — open the dashboard Settings tab to configure it');
    platformStatus.telegram = false;
    return;
  }
  if (currentTelegramBot) {
    logger.warn('Telegram bot already running');
    return;
  }
  const { createBot, COMMANDS } = require('./platforms/telegram');
  const { bot } = createBot();
  currentTelegramBot = bot;
  platformStatus.telegram = true;

  bot.telegram
    .setMyCommands(COMMANDS)
    .then(() => logger.info('command menu registered', { count: COMMANDS.length }))
    .catch((err) => logger.warn('setMyCommands failed', { err: err.message }));

  bot.launch().catch((err) => {
    logger.error('bot launch failed', { err: err.message });
    currentTelegramBot = null;
    platformStatus.telegram = false;
  });
  logger.info('telegram polling started');
}

function stopTelegramBot(reason) {
  if (currentTelegramBot) {
    try { currentTelegramBot.stop(reason); } catch {}
    currentTelegramBot = null;
    platformStatus.telegram = false;
  }
}

function startDiscordBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.discord?.botToken) {
    logger.warn('Discord bot token not configured — open the dashboard Settings tab to configure it');
    platformStatus.discord = false;
    return;
  }
  if (currentDiscordBot) {
    logger.warn('Discord bot already running');
    return;
  }
  const { createBot } = require('./platforms/discord');
  const { client } = createBot();
  currentDiscordBot = client;
  platformStatus.discord = true;

  client.login(cfg.discord.botToken).catch((err) => {
    logger.error('discord login failed', { err: err.message });
    currentDiscordBot = null;
    platformStatus.discord = false;
  });
  logger.info('discord client starting');
}

function stopDiscordBot() {
  if (currentDiscordBot) {
    try { currentDiscordBot.destroy(); } catch {}
    currentDiscordBot = null;
    platformStatus.discord = false;
  }
}

function startSlackBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.slack?.botToken || !cfg.slack?.appToken) {
    logger.warn('Slack tokens not configured — open the dashboard Settings tab to configure them');
    platformStatus.slack = false;
    return;
  }
  if (currentSlackApp) {
    logger.warn('Slack bot already running');
    return;
  }
  const { createBot } = require('./platforms/slack');
  const { app } = createBot();
  currentSlackApp = app;
  platformStatus.slack = true;

  app.start().catch((err) => {
    logger.error('slack app start failed', { err: err.message });
    currentSlackApp = null;
    platformStatus.slack = false;
  });
  logger.info('slack socket mode starting');
}

function stopSlackBot() {
  if (currentSlackApp) {
    try { currentSlackApp.stop(); } catch {}
    currentSlackApp = null;
    platformStatus.slack = false;
  }
}

function startTeamsBot() {
  const cfg = require('./lib/config').get();
  if (!cfg.teams?.appId || !cfg.teams?.appPassword) {
    logger.warn('Teams appId or appPassword not configured — open the dashboard Settings tab to configure them');
    platformStatus.teams = false;
    return;
  }
  if (currentTeamsAdapter) {
    logger.warn('Teams bot already running');
    return;
  }
  const { createBot } = require('./platforms/teams');
  const { adapter } = createBot();
  currentTeamsAdapter = adapter;
  platformStatus.teams = true;

  // Create a minimal Express app for Teams webhook
  const express = require('express');
  currentTeamsExpress = express();
  currentTeamsExpress.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
      // Activity processing is handled by adapter's processActivity callback
    }).catch((err) => {
      logger.error('Teams adapter activity failed', { err: err.message });
      res.status(500).send('Internal Server Error');
    });
  });

  // Webhook is typically mounted on the dashboard server or a separate port
  logger.info('teams adapter ready (webhook endpoint: /api/messages)');
}

function stopTeamsBot() {
  if (currentTeamsAdapter) {
    try {
      currentTeamsAdapter = null;
      currentTeamsExpress = null;
      platformStatus.teams = false;
    } catch {}
  }
}

function restartPlatforms() {
  logger.info('restarting chat platforms with new settings');
  stopTelegramBot('restart');
  stopDiscordBot();
  stopSlackBot();
  stopTeamsBot();
  require('./lib/config').reload();
  startTelegramBot();
  startDiscordBot();
  startSlackBot();
  startTeamsBot();
}

async function startInboundEmail() {
  if (!emailInboundStarted) {
    emailInboundStarted = true;
    platformStatus.email = true;
    startInboundListener().catch((err) => {
      logger.error('email inbound failed', { err: err.message });
      emailInboundStarted = false;
      platformStatus.email = false;
    });
  }
}

async function startGitHub() {
  if (!githubPollingStarted) {
    const cfg = require('./lib/config').get();
    if (cfg.github?.token) {
      try {
        githubPollingStarted = true;
        platformStatus.github = true;
        const ghPolling = getGitHubPolling();
        ghPolling.startPolling(120000);
      } catch (err) {
        logger.error('Failed to start GitHub polling', { err: err.message });
        githubPollingStarted = false;
        platformStatus.github = false;
      }
    }
  }
}

async function stopGitHub() {
  if (githubPollingStarted) {
    const ghPolling = getGitHubPolling();
    ghPolling.stopPolling();
    githubPollingStarted = false;
    platformStatus.github = false;
  }
}

async function stopEmail() {
  if (emailInboundStarted) {
    await stopInboundListener().catch(() => {});
    emailInboundStarted = false;
    platformStatus.email = false;
  }
}

function startPlatform(name) {
  switch (name.toLowerCase()) {
    case 'telegram':
      startTelegramBot();
      break;
    case 'discord':
      startDiscordBot();
      break;
    case 'slack':
      startSlackBot();
      break;
    case 'teams':
      startTeamsBot();
      break;
    case 'email':
      startInboundEmail();
      break;
    case 'github':
      startGitHub();
      break;
    default:
      logger.warn('Unknown platform', { name });
  }
}

function stopPlatform(name) {
  switch (name.toLowerCase()) {
    case 'telegram':
      stopTelegramBot('user-stop');
      break;
    case 'discord':
      stopDiscordBot();
      break;
    case 'slack':
      stopSlackBot();
      break;
    case 'teams':
      stopTeamsBot();
      break;
    case 'email':
      stopEmail();
      break;
    case 'github':
      stopGitHub();
      break;
    default:
      logger.warn('Unknown platform', { name });
  }
}

function getPlatformStatus() {
  const cfg = require('./lib/config').get();
  return {
    version: require('./package.json').version,
    port: config.port,
    platforms: {
      telegram: {
        running: platformStatus.telegram,
        configured: !!cfg.botToken,
      },
      discord: {
        running: platformStatus.discord,
        configured: !!cfg.discord?.botToken,
      },
      slack: {
        running: platformStatus.slack,
        configured: !!(cfg.slack?.botToken && cfg.slack?.appToken),
      },
      teams: {
        running: platformStatus.teams,
        configured: !!(cfg.teams?.appId && cfg.teams?.appPassword),
      },
      email: {
        running: platformStatus.email,
        configured: !!(cfg.smtp?.host && cfg.imap?.host),
      },
      github: {
        running: platformStatus.github,
        configured: !!cfg.github?.token,
      },
    },
    inflightChats: inflight.size,
  };
}

async function start() {
  logger.info('starting', {
    version: require('./package.json').version,
    port: config.port,
    timeoutMs: config.agentTimeoutMs,
    logLevel: config.logLevel,
    dashboardAuth: !!config.dashboardToken,
    permissionMode: config.permissionMode,
  });

  startTelegramBot();
  startDiscordBot();
  startSlackBot();
  startTeamsBot();

  server = createServer({
    getStatus: () => getPlatformStatus(),
    restartPlatforms,
    bot: module.exports,
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

  setTimeout(startInboundEmail, 3000);
  setTimeout(() => {
    try {
      startGitHub();
    } catch (err) {
      logger.warn('GitHub polling startup error (will retry)', { err: err.message });
    }
  }, 4000);
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { reason });
  for (const ac of inflight.values()) ac.abort();
  stopTelegramBot(reason);
  stopDiscordBot();
  stopSlackBot();
  stopTeamsBot();
  stopGitHub();
  if (server) server.close();
  stopEmail().catch(() => {});
  try { flushAll(); } catch (err) { logger.warn('flush failed', { err: err.message }); }
  setTimeout(() => process.exit(0), 800).unref();
}

if (require.main === module) {
  logger.info('starting PromptBridge from CLI');
  start();
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) =>
    logger.error('uncaught', { err: err.message, stack: err.stack }),
  );
  process.on('unhandledRejection', (err) =>
    logger.error('unhandledRejection', { err: String(err) }),
  );
}

module.exports = { start, shutdown, startPlatform, stopPlatform, getPlatformStatus, restartPlatforms };

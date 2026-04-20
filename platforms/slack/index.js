const fs = require('fs');
const { App } = require('@slack/bolt');
const {
  handleCommand,
  handleText,
  handleFiles,
  handleCallbackAction,
  getAttachmentCwd,
} = require('../../core/dispatcher');
const { formatSize } = require('../../lib/format');
const { make } = require('../../lib/logger');
const { SlackContext } = require('./context');
const { extractAttachments, downloadAll } = require('./attachments');

const log = make('slack');
const userCache = new Map();
const USER_CACHE_TTL_MS = 60_000;

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

function channelChatId(channel) {
  return `slack:${channel}`;
}

async function getUserNames(app, userId) {
  const cached = userCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.at < USER_CACHE_TTL_MS) return cached.names;

  try {
    const res = await app.client.users.info({ user: userId });
    const user = res.user || {};
    const profile = user.profile || {};
    const names = [
      normalizeName(user.name),
      normalizeName(profile.display_name),
      normalizeName(profile.real_name),
      normalizeName(profile.real_name_normalized),
      normalizeName(profile.display_name_normalized),
    ].filter(Boolean);
    userCache.set(userId, { at: now, names });
    return names;
  } catch (err) {
    log.warn('users.info failed', { userId, err: err.message });
    return [];
  }
}

async function isAllowed(app, cfg, userId, fallbackName) {
  if (userId && cfg.allowedUserIds.includes(userId)) return true;
  if (fallbackName && cfg.allowedUsernames.includes(normalizeName(fallbackName))) return true;
  if (!userId) return false;
  const names = await getUserNames(app, userId);
  return names.some((name) => cfg.allowedUsernames.includes(name));
}

async function maybeHandleAttachments(app, event) {
  const attachments = extractAttachments(event);
  if (!attachments.length) return false;

  const text = (event.text || '').trim();
  let agentOverride = null;
  let userPrompt = text;
  const claudeMatch = text.match(/^\/?claude(?:\s+([\s\S]*))?$/i);
  const cursorMatch = text.match(/^\/?cursor(?:\s+([\s\S]*))?$/i);
  const codexMatch = text.match(/^\/?codex(?:\s+([\s\S]*))?$/i);
  if (claudeMatch) { agentOverride = 'claude'; userPrompt = (claudeMatch[1] || '').trim(); }
  else if (cursorMatch) { agentOverride = 'cursor'; userPrompt = (cursorMatch[1] || '').trim(); }
  else if (codexMatch) { agentOverride = 'codex'; userPrompt = (codexMatch[1] || '').trim(); }
  if (!userPrompt) userPrompt = 'Analyze the attached file(s) and summarize the contents.';

  const threadTs = event.thread_ts || event.ts || null;
  const ctx = new SlackContext({
    client: app.client,
    channel: event.channel,
    threadTs,
    chatId: channelChatId(event.channel),
  });

  const cwdResult = getAttachmentCwd(ctx.chatId, agentOverride);
  if (cwdResult.error === 'no-project') {
    await ctx.sendText(
      'Attach a file with `/claude ...`, `/cursor ...`, or `/codex ...`, or activate a project first.',
    );
    return true;
  }
  if (cwdResult.error === 'project-missing') {
    await ctx.sendText('Active project missing. Use /projects.');
    return true;
  }

  await ctx.sendText(
    `📥 Downloading ${attachments.length} file${attachments.length === 1 ? '' : 's'}…`,
  );

  const token = require('../../lib/config').get().slack?.botToken;
  const saved = await downloadAll(token, attachments, cwdResult.cwd);
  const bad = saved.filter((s) => !s.path && !s.tooLarge);
  const tooBig = saved.filter((s) => s.tooLarge);
  if (tooBig.length || bad.length) {
    const msgs = [
      ...tooBig.map((s) => `• ${s.fileName}: too large (${formatSize(s.size)} > 25 MB)`),
      ...bad.map((s) => `• ${s.fileName}: ${s.error || 'unknown error'}`),
    ];
    await ctx.sendText(
      `⚠️ ${tooBig.length + bad.length} download issue${tooBig.length + bad.length === 1 ? '' : 's'}:\n${msgs.join('\n')}`,
    );
  }

  await handleFiles(ctx, saved, userPrompt, agentOverride);
  return true;
}

function createBot() {
  const cfg = require('../../lib/config').get();
  try { fs.mkdirSync(cfg.freeformCwd, { recursive: true }); } catch {}

  const app = new App({
    token: cfg.slack?.botToken,
    appToken: cfg.slack?.appToken,
    socketMode: true,
  });

  const slashCommands = ['help', 'dashboard', 'projects', 'current', 'model', 'reset', 'cancel'];
  for (const cmd of slashCommands) {
    app.command(`/${cmd}`, async ({ command, ack, client, body }) => {
      await ack();
      const current = require('../../lib/config').get().slack || {};
      if (!(await isAllowed(app, current, body.user_id, command.user_name))) return;
      const ctx = new SlackContext({
        client,
        channel: command.channel_id,
        chatId: channelChatId(command.channel_id),
      });
      await handleCommand(ctx, cmd, '');
    });
  }

  app.command('/use', async ({ command, ack, client, body }) => {
    await ack();
    const current = require('../../lib/config').get().slack || {};
    if (!(await isAllowed(app, current, body.user_id, command.user_name))) return;
    const ctx = new SlackContext({
      client,
      channel: command.channel_id,
      chatId: channelChatId(command.channel_id),
    });
    await handleCommand(ctx, 'use', command.text.trim());
  });

  for (const cmd of ['claude', 'cursor', 'codex']) {
    app.command(`/${cmd}`, async ({ command, ack, client, body }) => {
      await ack();
      const current = require('../../lib/config').get().slack || {};
      if (!(await isAllowed(app, current, body.user_id, command.user_name))) return;
      const ctx = new SlackContext({
        client,
        channel: command.channel_id,
        chatId: channelChatId(command.channel_id),
      });
      await handleCommand(ctx, cmd, command.text.trim());
    });
  }

  app.message(async ({ message, client, say }) => {
    if ((!message.user && !message.bot_id) || message.bot_id) return;
    if (message.subtype && message.subtype !== 'file_share') return;
    const current = require('../../lib/config').get().slack || {};
    if (!(await isAllowed(app, current, message.user, ''))) {
      log.warn('rejected slack user', { id: message.user });
      return;
    }

    try {
      if (await maybeHandleAttachments(app, message)) return;
      const text = (message.text || '').trim();
      if (!text) return;
      if (text.startsWith('/')) return;
      const threadTs = message.thread_ts || message.ts || null;
      const ctx = new SlackContext({
        client,
        channel: message.channel,
        threadTs,
        chatId: channelChatId(message.channel),
      });
      await handleText(ctx, text);
    } catch (err) {
      log.error('slack message handler failed', { err: err.message });
      try { await say(`❌ Error: ${err.message}`); } catch {}
    }
  });

  app.action(/.*/, async ({ body, action, ack, client }) => {
    await ack();
    const current = require('../../lib/config').get().slack || {};
    if (!(await isAllowed(app, current, body.user?.id, body.user?.username))) return;
    const ctx = new SlackContext({
      client,
      channel: body.channel?.id,
      threadTs: body.message?.thread_ts || null,
      actionTs: body.container?.message_ts || body.message?.ts || null,
      chatId: channelChatId(body.channel?.id),
    });
    await handleCallbackAction(ctx, action.action_id || action.value);
  });

  app.error((err) => {
    log.error('slack app error', { err: err.message });
  });

  return { app };
}

module.exports = { createBot };

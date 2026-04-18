const fs = require('fs');
const { Telegraf } = require('telegraf');
const { TelegramContext, TelegramCallbackContext } = require('./context');
const { extractAttachments, downloadAll } = require('./attachments');
const {
  handleCommand,
  handleText,
  handleFiles,
  handleCallbackAction,
  getAttachmentCwd,
  COMMANDS,
} = require('../../core/dispatcher');
const { formatSize } = require('../../lib/format');
const { make } = require('../../lib/logger');

const log = make('tg');

function stripCommand(text, command) {
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`), '').trim();
}

function createBot() {
  const cfg = require('../../lib/config').get();

  // Ensure Q&A scratch directory exists
  try { fs.mkdirSync(cfg.freeformCwd, { recursive: true }); } catch {}

  const bot = new Telegraf(cfg.botToken, { handlerTimeout: Infinity });

  log.info('allowlist loaded', {
    names: cfg.allowedUsernames,
    ids: cfg.allowedUserIds,
  });

  // ── Allowlist middleware — reads config fresh on every update ───────────────
  bot.use(async (ctx, next) => {
    const c = require('../../lib/config').get();
    const username = ctx.from?.username?.toLowerCase();
    const uid = ctx.from?.id;
    const allowed =
      (username && c.allowedUsernames.includes(username)) ||
      (uid && c.allowedUserIds.includes(uid));
    if (!allowed) {
      log.warn('rejected user', { username: ctx.from?.username, id: uid });
      return;
    }
    return next();
  });

  // ── Context wrappers ────────────────────────────────────────────────────────
  const wrap = (tgCtx) => new TelegramContext(tgCtx);
  const wrapCb = (tgCtx) => new TelegramCallbackContext(tgCtx);

  // ── Commands ────────────────────────────────────────────────────────────────
  bot.start((ctx) => handleCommand(wrap(ctx), 'start', ''));
  bot.command('help', (ctx) => handleCommand(wrap(ctx), 'help', ''));
  bot.command('dashboard', (ctx) => handleCommand(wrap(ctx), 'dashboard', ''));
  bot.command('projects', (ctx) => handleCommand(wrap(ctx), 'projects', ''));
  bot.command('use', (ctx) =>
    handleCommand(wrap(ctx), 'use', stripCommand(ctx.message.text, 'use')),
  );
  bot.command('current', (ctx) => handleCommand(wrap(ctx), 'current', ''));
  bot.command('model', (ctx) => handleCommand(wrap(ctx), 'model', ''));
  bot.command('reset', (ctx) => handleCommand(wrap(ctx), 'reset', ''));
  bot.command('cancel', (ctx) => handleCommand(wrap(ctx), 'cancel', ''));
  bot.command('claude', (ctx) =>
    handleCommand(wrap(ctx), 'claude', stripCommand(ctx.message.text, 'claude')),
  );
  bot.command('cursor', (ctx) =>
    handleCommand(wrap(ctx), 'cursor', stripCommand(ctx.message.text, 'cursor')),
  );

  // ── Plain text ──────────────────────────────────────────────────────────────
  bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    return handleText(wrap(ctx), ctx.message.text);
  });

  // ── File / media attachments ────────────────────────────────────────────────
  bot.on(
    ['document', 'photo', 'voice', 'audio', 'video', 'video_note', 'sticker'],
    async (ctx) => {
      const caption = (ctx.message.caption || '').trim();

      // Detect /claude or /cursor caption prefix
      let agentOverride = null;
      let userPrompt = caption;
      const claudeMatch = caption.match(/^\/claude(@\w+)?(?:\s+([\s\S]*))?$/);
      const cursorMatch = caption.match(/^\/cursor(@\w+)?(?:\s+([\s\S]*))?$/);
      if (claudeMatch) { agentOverride = 'claude'; userPrompt = (claudeMatch[2] || '').trim(); }
      else if (cursorMatch) { agentOverride = 'cursor'; userPrompt = (cursorMatch[2] || '').trim(); }
      if (!userPrompt) userPrompt = 'Analyze the attached file(s) and summarize the contents.';

      const attachments = extractAttachments(ctx.message);
      if (!attachments.length) return;

      // Resolve working directory via dispatcher (keeps session/project logic centralised)
      const chatId = String(ctx.chat.id);
      const cwdResult = getAttachmentCwd(chatId, agentOverride);
      if (cwdResult.error === 'no-project') {
        return ctx.reply(
          'Attach a file with caption /claude … or /cursor …, or /use an active project first.',
        );
      }
      if (cwdResult.error === 'project-missing') {
        return ctx.reply('Active project missing. Use /projects.');
      }

      await ctx.reply(
        `📥 Downloading ${attachments.length} file${attachments.length === 1 ? '' : 's'}…`,
      );
      ctx.sendChatAction('typing').catch(() => {});

      const saved = await downloadAll(
        (fileId) => ctx.telegram.getFileLink(fileId),
        attachments,
        cwdResult.cwd,
      );

      // Report any download failures
      const bad = saved.filter((s) => !s.path && !s.tooLarge);
      const tooBig = saved.filter((s) => s.tooLarge);
      if (tooBig.length || bad.length) {
        const msgs = [
          ...tooBig.map((s) => `• ${s.fileName}: too large (${formatSize(s.size)} > 20 MB)`),
          ...bad.map((s) => `• ${s.fileName}: ${s.error || 'unknown error'}`),
        ];
        await ctx.reply(
          `⚠️ ${tooBig.length + bad.length} download issue${tooBig.length + bad.length === 1 ? '' : 's'}:\n${msgs.join('\n')}`,
        );
      }

      return handleFiles(wrap(ctx), saved, userPrompt, agentOverride);
    },
  );

  // ── Inline button callbacks (catch-all → dispatcher) ────────────────────────
  bot.action(/^(.+)$/, async (ctx) => {
    return handleCallbackAction(wrapCb(ctx), ctx.match[1]);
  });

  bot.catch((err, ctx) => {
    log.error('telegraf error', { update: ctx?.updateType, err: err.message });
  });

  return { bot, COMMANDS };
}

module.exports = { createBot, COMMANDS };

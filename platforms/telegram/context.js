const { Markup } = require('telegraf');
const { BotContext } = require('../../core/context');
const { toHtml, chunkHtml, escapeHtml, stripTags } = require('../../lib/format');
const { make } = require('../../lib/logger');

const TG_HARD_LIMIT = 4096;
const log = make('tg:ctx');

// ─── Flood-control retry (Telegram-specific) ──────────────────────────────────

function retryAfterMs(err) {
  const p =
    err?.parameters?.retry_after ??
    err?.response?.parameters?.retry_after ??
    err?.on?.payload?.parameters?.retry_after;
  return Number.isFinite(p) ? Number(p) * 1000 + 500 : null;
}

async function withFloodRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i <= attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const wait = retryAfterMs(err);
      if (wait && i < attempts) {
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Button row conversion ────────────────────────────────────────────────────

function toTgButtons(buttonRows) {
  return buttonRows.map((row) =>
    row.map((btn) => Markup.button.callback(btn.label, btn.id)),
  );
}

// ─── TelegramContext ──────────────────────────────────────────────────────────

class TelegramContext extends BotContext {
  constructor(telegrafCtx) {
    super();
    this._ctx = telegrafCtx;
  }

  get chatId() { return String(this._ctx.chat.id); }
  get platform() { return 'telegram'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return true; }

  showTyping() {
    this._ctx.sendChatAction('typing').catch(() => {});
  }

  /** Internal: send pre-built HTML (already chunked by caller if needed). */
  async _sendHtmlChunk(html, opts = {}) {
    const payload = html.slice(0, TG_HARD_LIMIT);
    try {
      return await withFloodRetry(() =>
        this._ctx.reply(payload, { parse_mode: 'HTML', disable_web_page_preview: true, ...opts }),
      );
    } catch {
      // Fall back to plain text if HTML parse fails
      const plain = stripTags(payload).slice(0, TG_HARD_LIMIT);
      return withFloodRetry(() =>
        this._ctx.reply(plain, { disable_web_page_preview: true, ...opts }),
      );
    }
  }

  async sendMarkdown(md) {
    const html = toHtml(md || '(empty)');
    const chunks = chunkHtml(html);
    let lastId = null;
    for (const chunk of chunks) {
      const msg = await this._sendHtmlChunk(chunk);
      lastId = msg.message_id;
    }
    return lastId;
  }

  async sendText(text) {
    const msg = await withFloodRetry(() =>
      this._ctx.reply(String(text), { disable_web_page_preview: true }),
    );
    return msg.message_id;
  }

  async editMessage(messageId, md) {
    const html = toHtml(md).slice(0, TG_HARD_LIMIT);
    await withFloodRetry(() =>
      this._ctx.telegram.editMessageText(
        this._ctx.chat.id,
        messageId,
        undefined,
        html,
        { parse_mode: 'HTML', disable_web_page_preview: true },
      ),
    ).catch((err) => {
      const msg = err.description || err.message || '';
      if (!/message is not modified/i.test(msg)) {
        log.debug('editMessage failed', { err: msg });
      }
    });
  }

  async sendFile(filePath, caption) {
    await withFloodRetry(() =>
      this._ctx.replyWithDocument(
        { source: filePath },
        caption
          ? { caption: escapeHtml(caption), parse_mode: 'HTML' }
          : {},
      ),
    );
  }

  async sendWithButtons(md, buttonRows) {
    const html = toHtml(md).slice(0, TG_HARD_LIMIT);
    const keyboard = Markup.inlineKeyboard(toTgButtons(buttonRows));
    const msg = await withFloodRetry(() =>
      this._ctx.reply(html, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...keyboard,
      }),
    );
    return msg.message_id;
  }
}

// ─── TelegramCallbackContext (for inline button presses) ──────────────────────

class TelegramCallbackContext extends TelegramContext {
  async acknowledgeAction(text) {
    await this._ctx.answerCbQuery(text || undefined).catch(() => {});
  }

  async updateButtonMessage(md, buttonRows) {
    const html = toHtml(md).slice(0, TG_HARD_LIMIT);
    const opts = { parse_mode: 'HTML', disable_web_page_preview: true };
    if (buttonRows && buttonRows.length) {
      Object.assign(opts, Markup.inlineKeyboard(toTgButtons(buttonRows)));
    }
    try {
      await this._ctx.editMessageText(html, opts);
    } catch (err) {
      const msg = err.description || err.message || '';
      if (!/message is not modified/i.test(msg)) throw err;
    }
  }
}

module.exports = { TelegramContext, TelegramCallbackContext, withFloodRetry };

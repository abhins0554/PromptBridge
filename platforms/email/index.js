const path = require('path');
const nodemailer = require('nodemailer');
const { BotContext } = require('../../core/context');

// ─── Mailer factory ───────────────────────────────────────────────────────────

function createMailer(emailCfg) {
  return nodemailer.createTransport({
    host: emailCfg.smtpHost,
    port: Number(emailCfg.smtpPort) || 587,
    secure: !!emailCfg.smtpSecure,
    auth: emailCfg.smtpUser
      ? { user: emailCfg.smtpUser, pass: emailCfg.smtpPass }
      : undefined,
  });
}

async function verifyMailer(emailCfg) {
  const transporter = createMailer(emailCfg);
  await transporter.verify();
  return transporter;
}

// ─── EmailContext ─────────────────────────────────────────────────────────────

/**
 * BotContext implementation for email delivery.
 *
 * Messages are buffered in memory. Call flush() after the agent run completes
 * to send one consolidated email containing the full conversation output.
 *
 * Intermediate status messages (e.g. "⚙️ running…") are updated via
 * editMessage() and land in the email with their final content only.
 */
class EmailContext extends BotContext {
  constructor({ chatId, mailer, to, from, inReplyTo, references }) {
    super();
    this._chatId = chatId;
    this._mailer = mailer;
    this._to = to;
    this._from = from;
    this._inReplyTo = inReplyTo;
    this._references = references;
    this._slots = new Map(); // messageId → { md, type }
    this._order = [];        // insertion order of messageIds
    this._counter = 0;
    this._attachments = [];
  }

  get chatId() { return this._chatId; }
  get platform() { return 'email'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return false; }

  showTyping() {} // no-op for email

  async sendMarkdown(md) {
    const id = ++this._counter;
    this._slots.set(id, { md: md || '', type: 'text' });
    this._order.push(id);
    return id;
  }

  async sendText(text) {
    return this.sendMarkdown(text);
  }

  async editMessage(messageId, md) {
    const slot = this._slots.get(messageId);
    if (slot) slot.md = md || '';
  }

  async sendFile(filePath, caption) {
    this._attachments.push({
      filename: path.basename(filePath),
      path: filePath,
      caption: caption || '',
    });
  }

  async sendWithButtons(md, _buttonRows) {
    // Buttons are not meaningful in email — send just the text
    return this.sendMarkdown(md);
  }

  /**
   * Send all buffered content as a single email.
   * Call this after the agent run resolves (success or error).
   * @param {string} subject
   */
  async flush(subject) {
    const parts = this._order
      .map((id) => this._slots.get(id))
      .filter((s) => s && s.md && s.md.trim() && s.md.trim() !== '(empty)');

    const plainText = parts.map((s) => s.md).join('\n\n');

    // Build a minimal HTML version for email clients that prefer it
    const htmlBody = parts
      .map((s) => `<p style="white-space:pre-wrap;font-family:inherit;margin:0 0 1em">${escapeHtml(s.md)}</p>`)
      .join('\n');

    const attachments = this._attachments.map((a) => ({
      filename: a.filename,
      path: a.path,
    }));

    await this._mailer.sendMail({
      from: this._from,
      to: this._to,
      subject,
      inReplyTo: this._inReplyTo,
      references: this._references,
      text: plainText || '(no response)',
      html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;color:#1a1a1a;max-width:720px;margin:auto;padding:24px">
<h2 style="font-size:16px;color:#555;margin:0 0 16px">${escapeHtml(subject)}</h2>
${htmlBody}
${attachments.length ? `<hr style="margin:16px 0"><p style="color:#777;font-size:13px">${attachments.length} file(s) attached.</p>` : ''}
<hr style="margin:24px 0"><p style="color:#999;font-size:12px">Sent by PromptBridge</p>
</body></html>`,
      attachments,
    });
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { EmailContext, createMailer, verifyMailer };

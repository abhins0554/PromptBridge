/**
 * Platform-agnostic bot context interface.
 *
 * Platform adapters (Telegram, Discord, …) wrap their native event object
 * and implement these methods. The dispatcher only calls methods defined here,
 * keeping all business logic free of platform-specific imports.
 */
class BotContext {
  /** @returns {string} Stable unique ID for this chat / channel / DM. */
  get chatId() { throw new Error('chatId not implemented') }

  /** @returns {string} e.g. 'telegram' | 'discord' */
  get platform() { throw new Error('platform not implemented') }

  /**
   * Send a Markdown-formatted message.
   * The platform converts to its native format (HTML for Telegram, native MD for Discord).
   * @param {string} md
   * @returns {Promise<string|number>} opaque messageId for later editMessage() calls
   */
  async sendMarkdown(md) { throw new Error('sendMarkdown not implemented') }

  /**
   * Send a plain-text message (no formatting).
   * Default delegates to sendMarkdown, platforms may override for efficiency.
   * @param {string} text
   * @returns {Promise<string|number>} messageId
   */
  async sendText(text) { return this.sendMarkdown(text) }

  /**
   * Edit a previously sent message.
   * No-op on platforms that do not support editing.
   * @param {string|number} messageId
   * @param {string} md  Markdown content to replace the message with
   */
  async editMessage(messageId, md) {}

  /**
   * Show a typing / processing indicator. Fire-and-forget; errors are silently swallowed.
   */
  showTyping() {}

  /**
   * Upload a file from disk and send it in this chat.
   * @param {string} filePath  Absolute path on disk
   * @param {string} [caption]
   */
  async sendFile(filePath, caption) { throw new Error('sendFile not implemented') }

  /**
   * Send a message accompanied by interactive buttons.
   * Falls back to plain sendMarkdown on platforms without button support.
   * @param {string} md
   * @param {Array<Array<{label: string, id: string}>>} buttonRows  2-D array of buttons
   * @returns {Promise<string|number>} messageId
   */
  async sendWithButtons(md, buttonRows) { return this.sendMarkdown(md) }

  /**
   * Acknowledge a button / interaction callback.
   * No-op on platforms / contexts where this is not applicable.
   * @param {string} [text]  Optional toast text (Telegram: popup, Discord: ephemeral)
   */
  async acknowledgeAction(text) {}

  /**
   * Edit the message that contained the button the user just clicked.
   * Used to update inline menus in-place. No-op if not in a callback context.
   * @param {string} md
   * @param {Array<Array<{label: string, id: string}>>} [buttonRows]
   */
  async updateButtonMessage(md, buttonRows) {}

  /** @returns {boolean} Whether this platform supports editing sent messages. */
  get canEditMessages() { return false }

  /** @returns {boolean} Whether this platform supports interactive inline buttons. */
  get canUseButtons() { return false }
}

module.exports = { BotContext };

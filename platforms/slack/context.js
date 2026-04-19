const path = require('path');
const { BotContext } = require('../../core/context');
const { truncate } = require('../../lib/format');
const { make } = require('../../lib/logger');

const log = make('slack:ctx');
const SLACK_LIMIT = 3500;

function chunkMarkdown(md) {
  const text = String(md || '(empty)');
  if (text.length <= SLACK_LIMIT) return [text];
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + SLACK_LIMIT, text.length);
    if (end < text.length) {
      const split = text.lastIndexOf('\n', end);
      if (split > i + 800) end = split;
    }
    out.push(text.slice(i, end));
    i = end;
    while (i < text.length && text[i] === '\n') i++;
  }
  return out.filter(Boolean);
}

function toBlocks(md, buttonRows) {
  const blocks = [];
  for (const chunk of chunkMarkdown(md)) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    });
  }
  for (const row of buttonRows || []) {
    blocks.push({
      type: 'actions',
      elements: row.slice(0, 5).map((btn) => ({
        type: 'button',
        text: { type: 'plain_text', text: truncate(btn.label, 75) },
        action_id: btn.id,
        value: btn.id,
      })),
    });
  }
  return blocks.slice(0, 50);
}

class SlackContext extends BotContext {
  constructor({ client, channel, threadTs, chatId, actionTs = null }) {
    super();
    this._client = client;
    this._channel = channel;
    this._threadTs = threadTs || null;
    this._chatId = chatId;
    this._actionTs = actionTs;
  }

  get chatId() { return this._chatId; }
  get platform() { return 'slack'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return true; }

  showTyping() {}

  async sendMarkdown(md) {
    let last = null;
    for (const chunk of chunkMarkdown(md)) {
      last = await this._client.chat.postMessage({
        channel: this._channel,
        thread_ts: this._threadTs || undefined,
        text: chunk,
        mrkdwn: true,
      });
    }
    return last?.ts || null;
  }

  async sendText(text) {
    const res = await this._client.chat.postMessage({
      channel: this._channel,
      thread_ts: this._threadTs || undefined,
      text: String(text || ''),
      mrkdwn: false,
    });
    return res.ts;
  }

  async editMessage(messageId, md) {
    try {
      await this._client.chat.update({
        channel: this._channel,
        ts: messageId,
        text: chunkMarkdown(md)[0] || '(empty)',
        mrkdwn: true,
      });
    } catch (err) {
      log.debug('editMessage failed', { err: err.message });
    }
  }

  async sendFile(filePath, caption) {
    await this._client.files.uploadV2({
      channel_id: this._channel,
      thread_ts: this._threadTs || undefined,
      file: filePath,
      filename: path.basename(filePath),
      initial_comment: caption || undefined,
    });
  }

  async sendWithButtons(md, buttonRows) {
    const res = await this._client.chat.postMessage({
      channel: this._channel,
      thread_ts: this._threadTs || undefined,
      text: chunkMarkdown(md)[0] || '(empty)',
      mrkdwn: true,
      blocks: toBlocks(md, buttonRows),
    });
    return res.ts;
  }

  async acknowledgeAction() {}

  async updateButtonMessage(md, buttonRows) {
    if (!this._actionTs) return;
    await this._client.chat.update({
      channel: this._channel,
      ts: this._actionTs,
      text: chunkMarkdown(md)[0] || '(empty)',
      mrkdwn: true,
      blocks: toBlocks(md, buttonRows || []),
    });
  }
}

module.exports = { SlackContext, chunkMarkdown };

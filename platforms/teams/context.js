const { MessageFactory, CardFactory } = require('botbuilder');
const { BotContext } = require('../../core/context');
const { truncate } = require('../../lib/format');
const { make } = require('../../lib/logger');

const log = make('teams:ctx');
const TEAMS_LIMIT = 4000; // Teams supports larger messages

function chunkMarkdown(md) {
  const text = String(md || '(empty)');
  if (text.length <= TEAMS_LIMIT) return [text];

  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + TEAMS_LIMIT, text.length);
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

function toTeamsButtons(buttonRows) {
  // Teams Action.OpenUrl or Action.Submit
  // For now, using Action.Submit with id
  const actions = [];
  for (const row of buttonRows) {
    for (const btn of row.slice(0, 6)) { // Teams allows up to 6 actions per card
      actions.push({
        '@type': 'Action.Submit',
        title: truncate(btn.label, 80),
        data: { action: 'button', id: btn.id },
      });
    }
  }
  return actions;
}

class TeamsContext extends BotContext {
  constructor(context) {
    super();
    this._context = context;
    this._activity = context.activity;
    
    // Store edit history for in-place updates
    this._lastMessageId = null;
  }

  get chatId() {
    // Teams conversation ID is stable per team/channel
    return `teams:${this._activity.channelData?.teamsChannelId || this._activity.conversation.id}`;
  }

  get platform() { return 'teams'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return true; }

  showTyping() {
    // Teams doesn't have a native typing indicator, but we can use typing activity
    this._context.sendActivity({ type: 'typing' }).catch(() => {});
  }

  async sendMarkdown(md) {
    const chunks = chunkMarkdown(md);
    let lastId = null;
    for (const chunk of chunks) {
      const msg = MessageFactory.text(chunk);
      const response = await this._context.sendActivity(msg);
      lastId = response.id;
    }
    this._lastMessageId = lastId;
    return lastId;
  }

  async sendText(text) {
    const msg = MessageFactory.text(String(text || ''));
    const response = await this._context.sendActivity(msg);
    this._lastMessageId = response.id;
    return response.id;
  }

  async editMessage(messageId, md) {
    try {
      const text = chunkMarkdown(md)[0] || '(empty)';
      const msg = MessageFactory.text(text);
      msg.id = messageId;
      await this._context.updateActivity(msg);
    } catch (err) {
      log.debug('editMessage failed', { err: err.message });
    }
  }

  async sendFile(filePath, caption) {
    try {
      const fs = require('fs');
      const path = require('path');
      const fileName = path.basename(filePath);
      
      // Teams doesn't natively support file uploads in the same way
      // We send a link or attachment metadata
      const statsSync = fs.statSync(filePath);
      const msg = MessageFactory.text(
        `${caption || ''}\n📎 File: ${fileName} (${Math.round(statsSync.size / 1024)} KB)`
      );
      await this._context.sendActivity(msg);
    } catch (err) {
      log.debug('sendFile failed', { err: err.message });
    }
  }

  async sendWithButtons(md, buttonRows) {
    try {
      const actions = toTeamsButtons(buttonRows);
      if (!actions.length) return this.sendMarkdown(md);

      const card = CardFactory.adaptiveCard({
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: chunkMarkdown(md)[0] || '(empty)',
            wrap: true,
          },
        ],
        actions: actions.slice(0, 6), // Teams limits to 6 actions
      });

      const response = await this._context.sendActivity({ attachments: [card] });
      this._lastMessageId = response.id;
      return response.id;
    } catch (err) {
      log.debug('sendWithButtons failed, falling back to markdown', { err: err.message });
      return this.sendMarkdown(md);
    }
  }

  async acknowledgeAction(text) {
    // Teams doesn't support ephemeral messages like Discord
    // We could use a reply or just acknowledge silently
    if (text) {
      log.debug('acknowledgeAction', { text });
    }
  }

  async updateButtonMessage(md, buttonRows) {
    if (!this._lastMessageId) return;
    try {
      const actions = toTeamsButtons(buttonRows);
      if (!actions.length) {
        await this.editMessage(this._lastMessageId, md);
        return;
      }

      const card = CardFactory.adaptiveCard({
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: chunkMarkdown(md)[0] || '(empty)',
            wrap: true,
          },
        ],
        actions: actions.slice(0, 6),
      });

      const msg = { attachments: [card] };
      msg.id = this._lastMessageId;
      await this._context.updateActivity(msg);
    } catch (err) {
      log.debug('updateButtonMessage failed', { err: err.message });
    }
  }
}

module.exports = { TeamsContext };

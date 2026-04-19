const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BotContext } = require('../../core/context');
const { truncate } = require('../../lib/format');
const { make } = require('../../lib/logger');

const log = make('discord:ctx');
const DISCORD_LIMIT = 2000;

function chunkMarkdown(md) {
  const text = String(md || '(empty)');
  if (text.length <= DISCORD_LIMIT) return [text];

  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + DISCORD_LIMIT, text.length);
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

function toDiscordRows(buttonRows) {
  return buttonRows.map((row) =>
    new ActionRowBuilder().addComponents(
      row.slice(0, 5).map((btn) =>
        new ButtonBuilder()
          .setCustomId(btn.id)
          .setLabel(truncate(btn.label, 80))
          .setStyle(ButtonStyle.Secondary),
      ),
    ),
  );
}

class DiscordContext extends BotContext {
  constructor(message) {
    super();
    this._message = message;
    this._channel = message.channel;
  }

  get chatId() { return `discord:${this._channel.id}`; }
  get platform() { return 'discord'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return true; }

  showTyping() {
    this._channel.sendTyping().catch(() => {});
  }

  async sendMarkdown(md) {
    const chunks = chunkMarkdown(md);
    let last = null;
    for (const chunk of chunks) {
      last = await this._channel.send({ content: chunk });
    }
    return last?.id || null;
  }

  async sendText(text) {
    const msg = await this._channel.send({ content: String(text || '') });
    return msg.id;
  }

  async editMessage(messageId, md) {
    try {
      const msg = await this._channel.messages.fetch(messageId);
      await msg.edit({ content: chunkMarkdown(md)[0] || '(empty)' });
    } catch (err) {
      log.debug('editMessage failed', { err: err.message });
    }
  }

  async sendFile(filePath, caption) {
    await this._channel.send({
      content: caption || undefined,
      files: [new AttachmentBuilder(filePath)],
    });
  }

  async sendWithButtons(md, buttonRows) {
    const msg = await this._channel.send({
      content: chunkMarkdown(md)[0] || '(empty)',
      components: toDiscordRows(buttonRows).slice(0, 5),
    });
    return msg.id;
  }
}

class DiscordInteractionContext extends BotContext {
  constructor(interaction) {
    super();
    this._interaction = interaction;
    this._channel = interaction.channel;
  }

  get chatId() { return `discord:${this._channel.id}`; }
  get platform() { return 'discord'; }
  get canEditMessages() { return true; }
  get canUseButtons() { return true; }

  showTyping() {
    this._channel?.sendTyping().catch(() => {});
  }

  async _ensureDeferred(ephemeral = false) {
    if (this._interaction.deferred || this._interaction.replied) return;
    await this._interaction.deferReply({ ephemeral }).catch(() => {});
  }

  async sendMarkdown(md) {
    const chunks = chunkMarkdown(md);
    let last = null;
    if (!this._interaction.deferred && !this._interaction.replied) {
      last = await this._interaction.reply({ content: chunks[0], fetchReply: true });
      for (const chunk of chunks.slice(1)) last = await this._channel.send({ content: chunk });
      return last?.id || null;
    }
    for (const [idx, chunk] of chunks.entries()) {
      last = idx === 0
        ? await this._interaction.followUp({ content: chunk, fetchReply: true })
        : await this._channel.send({ content: chunk });
    }
    return last?.id || null;
  }

  async sendText(text) {
    return this.sendMarkdown(String(text || ''));
  }

  async editMessage(messageId, md) {
    try {
      const msg = await this._channel.messages.fetch(messageId);
      await msg.edit({ content: chunkMarkdown(md)[0] || '(empty)' });
    } catch (err) {
      log.debug('editMessage failed', { err: err.message });
    }
  }

  async sendFile(filePath, caption) {
    await this._ensureDeferred(false);
    await this._interaction.followUp({
      content: caption || undefined,
      files: [new AttachmentBuilder(filePath)],
    });
  }

  async sendWithButtons(md, buttonRows) {
    const payload = {
      content: chunkMarkdown(md)[0] || '(empty)',
      components: toDiscordRows(buttonRows).slice(0, 5),
      fetchReply: true,
    };
    if (!this._interaction.deferred && !this._interaction.replied) {
      const msg = await this._interaction.reply(payload);
      return msg?.id || null;
    }
    const msg = await this._interaction.followUp(payload);
    return msg?.id || null;
  }

  async acknowledgeAction(text) {
    if (this._interaction.isButton()) {
      if (!this._interaction.deferred && !this._interaction.replied) {
        await this._interaction.deferUpdate().catch(() => {});
      }
      if (text) {
        await this._interaction.followUp({ content: text, ephemeral: true }).catch(() => {});
      }
      return;
    }
    if (!text) return;
    if (!this._interaction.deferred && !this._interaction.replied) {
      await this._interaction.reply({ content: text, ephemeral: true }).catch(() => {});
    } else {
      await this._interaction.followUp({ content: text, ephemeral: true }).catch(() => {});
    }
  }

  async updateButtonMessage(md, buttonRows) {
    if (!this._interaction.isButton()) return;
    const payload = {
      content: chunkMarkdown(md)[0] || '(empty)',
      components: toDiscordRows(buttonRows || []).slice(0, 5),
    };
    if (!this._interaction.deferred && !this._interaction.replied) {
      await this._interaction.update(payload);
      return;
    }
    await this._interaction.message.edit(payload);
  }
}

module.exports = { DiscordContext, DiscordInteractionContext, chunkMarkdown };

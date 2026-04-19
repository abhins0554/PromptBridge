const fs = require('fs');
const {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require('discord.js');
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
const { DiscordContext, DiscordInteractionContext } = require('./context');
const { extractAttachments, downloadAll } = require('./attachments');

const log = make('discord');

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

function stripCommandPrefix(text, command) {
  return text.replace(new RegExp(`^/${command}\\s*`, 'i'), '').trim();
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Show help'),
    new SlashCommandBuilder().setName('dashboard').setDescription('Open the web dashboard'),
    new SlashCommandBuilder().setName('projects').setDescription('List configured projects'),
    new SlashCommandBuilder().setName('current').setDescription('Show active project + session'),
    new SlashCommandBuilder().setName('model').setDescription('Pick model for Q&A or active project'),
    new SlashCommandBuilder().setName('reset').setDescription('Start a fresh session'),
    new SlashCommandBuilder().setName('cancel').setDescription('Abort the running agent'),
    new SlashCommandBuilder()
      .setName('use')
      .setDescription('Set active project for this channel')
      .addStringOption((opt) =>
        opt.setName('project').setDescription('Project name').setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('claude')
      .setDescription('Ask Claude without an active project')
      .addStringOption((opt) =>
        opt.setName('prompt').setDescription('Prompt').setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('cursor')
      .setDescription('Ask Cursor without an active project')
      .addStringOption((opt) =>
        opt.setName('prompt').setDescription('Prompt').setRequired(true),
      ),
  ].map((cmd) => cmd.toJSON());
}

function isAllowed(message, cfg) {
  const username = normalizeName(message.author?.username);
  const globalName = normalizeName(message.author?.globalName);
  const uid = message.author?.id;
  return (
    (username && cfg.allowedUsernames.includes(username)) ||
    (globalName && cfg.allowedUsernames.includes(globalName)) ||
    (uid && cfg.allowedUserIds.includes(uid))
  );
}

function canReceiveMessages(channel) {
  return !!channel && (
    channel.type === ChannelType.DM ||
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread
  );
}

async function maybeHandleAttachments(message) {
  if (!message.attachments.size) return false;

  const content = (message.content || '').trim();
  let agentOverride = null;
  let userPrompt = content;
  const claudeMatch = content.match(/^\/claude(?:\s+([\s\S]*))?$/i);
  const cursorMatch = content.match(/^\/cursor(?:\s+([\s\S]*))?$/i);
  if (claudeMatch) { agentOverride = 'claude'; userPrompt = (claudeMatch[1] || '').trim(); }
  else if (cursorMatch) { agentOverride = 'cursor'; userPrompt = (cursorMatch[1] || '').trim(); }
  if (!userPrompt) userPrompt = 'Analyze the attached file(s) and summarize the contents.';

  const attachments = extractAttachments(message);
  if (!attachments.length) return false;

  const ctx = new DiscordContext(message);
  const cwdResult = getAttachmentCwd(ctx.chatId, agentOverride);
  if (cwdResult.error === 'no-project') {
    await ctx.sendText(
      'Attach a file with `/claude ...` or `/cursor ...`, or activate a project first.',
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
  ctx.showTyping();

  const saved = await downloadAll(attachments, cwdResult.cwd);
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

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.ClientReady, async (readyClient) => {
    log.info('discord connected', { user: readyClient.user.tag });
    try {
      await readyClient.application.commands.set(buildSlashCommands());
      log.info('discord slash commands registered', { count: COMMANDS.length });
    } catch (err) {
      log.warn('discord command registration failed', { err: err.message });
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author?.bot || !canReceiveMessages(message.channel)) return;
    const current = require('../../lib/config').get().discord || {};
    if (!isAllowed(message, current)) {
      log.warn('rejected discord user', {
        username: message.author?.username,
        id: message.author?.id,
      });
      return;
    }

    try {
      if (await maybeHandleAttachments(message)) return;
      const content = (message.content || '').trim();
      if (!content) return;
      const ctx = new DiscordContext(message);

      if (content.startsWith('/')) {
        const match = content.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
        if (!match) return;
        await handleCommand(ctx, match[1].toLowerCase(), (match[2] || '').trim());
        return;
      }

      await handleText(ctx, content);
    } catch (err) {
      log.error('discord message handler failed', { err: err.message });
      try {
        await message.channel.send(`❌ Error: ${err.message}`);
      } catch {}
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    const current = require('../../lib/config').get().discord || {};
    const allowed =
      (interaction.user?.id && current.allowedUserIds.includes(interaction.user.id)) ||
      current.allowedUsernames.includes(normalizeName(interaction.user?.username)) ||
      current.allowedUsernames.includes(normalizeName(interaction.user?.globalName));
    if (!allowed) return;

    const ctx = new DiscordInteractionContext(interaction);

    try {
      if (interaction.isButton()) {
        await handleCallbackAction(ctx, interaction.customId);
        return;
      }

      if (!interaction.isChatInputCommand()) return;
      const name = interaction.commandName;
      const arg =
        interaction.options.getString('project') ||
        interaction.options.getString('prompt') ||
        '';
      await handleCommand(ctx, name, arg);
    } catch (err) {
      log.error('discord interaction failed', { err: err.message, type: interaction.type });
      try {
        await ctx.sendText(`❌ Error: ${err.message}`);
      } catch {}
    }
  });

  return { client };
}

module.exports = { createBot };

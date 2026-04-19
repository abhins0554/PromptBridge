const fs = require('fs');
const path = require('path');
const express = require('express');
const { BotFrameworkAdapter, ConversationState, MemoryStorage } = require('botbuilder');
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
const { TeamsContext } = require('./context');
const { extractAttachments, downloadAll } = require('./attachments');

const log = make('teams');

function createBot() {
  const cfg = require('../../lib/config').get();

  try { fs.mkdirSync(cfg.freeformCwd, { recursive: true }); } catch {}

  // Create adapter
  const adapter = new BotFrameworkAdapter({
    appId: cfg.teams?.appId || '',
    appPassword: cfg.teams?.appPassword || '',
  });

  // Set up memory storage for conversation state
  const storage = new MemoryStorage();
  const conversationState = new ConversationState(storage);

  // Error handling middleware
  adapter.onTurnError = async (context, error) => {
    log.error('bot turn error', { err: error.message, stack: error.stack });
    try {
      await context.sendActivity('Sorry, an error occurred. Please try again.');
    } catch (sendErr) {
      log.error('error sending error message', { err: sendErr.message });
    }
  };

  // Main activity processing
  adapter.processActivity(async (context) => {
    try {
      const activity = context.activity;

      // Skip non-message activities (unless they're invoke events for buttons)
      if (activity.type !== 'message' && activity.type !== 'invoke') {
        log.debug('skipping activity', { type: activity.type });
        return;
      }

      // Check permissions
      if (!isAllowed(activity, cfg)) {
        log.warn('user not allowed', { from: activity.from?.name, userId: activity.from?.id });
        await context.sendActivity('You are not authorized to use this bot.');
        return;
      }

      const botCtx = new TeamsContext(context);

      // Handle button callbacks (invoke events)
      if (activity.type === 'invoke') {
        if (activity.name === 'adaptiveCard/action') {
          const data = activity.value?.data || {};
          if (data.action === 'button' && data.id) {
            await handleCallbackAction(botCtx, data.id);
            await context.sendActivity({ type: 'invokeResponse', value: { status: 200 } });
            return;
          }
        }
        return;
      }

      // Handle text messages
      const text = (activity.text || '').trim();
      if (!text && !activity.attachments?.length) return;

      // Check for command
      const cmdMatch = text.match(/^\/(\w+)(?:\s+(.*))?$/);
      if (cmdMatch) {
        const [, cmd, args] = cmdMatch;
        if (COMMANDS.some((c) => c.command === cmd)) {
          await handleCommand(botCtx, cmd, args);
          return;
        }
      }

      // Handle attachments
      if (activity.attachments?.length) {
        const handled = await maybeHandleAttachments(context, activity, botCtx, text);
        if (handled) return;
      }

      // Handle regular text
      if (text) {
        await handleText(botCtx, text);
      }
    } catch (err) {
      log.error('process activity error', { err: err.message, stack: err.stack });
    }
  });

  return { adapter, conversationState };
}

function isAllowed(activity, cfg) {
  const username = String(activity.from?.name || '').toLowerCase();
  const userId = String(activity.from?.id || '');

  const teamsConfig = cfg.teams || {};
  const allowedUsernames = teamsConfig.allowedUsernames || [];
  const allowedUserIds = teamsConfig.allowedUserIds || [];

  return (
    (username && allowedUsernames.some((u) => username.includes(u.toLowerCase()))) ||
    (userId && allowedUserIds.includes(userId)) ||
    allowedUsernames.length === 0 // Allow all if no restrictions
  );
}

async function maybeHandleAttachments(context, activity, botCtx, userPrompt) {
  if (!activity.attachments?.length) return false;

  const attachments = extractAttachments(activity);
  if (!attachments.length) return false;

  let agentOverride = null;
  let prompt = userPrompt;

  // Check for /claude or /cursor prefixes
  const claudeMatch = userPrompt.match(/^\/claude(?:\s+([\s\S]*))?$/i);
  const cursorMatch = userPrompt.match(/^\/cursor(?:\s+([\s\S]*))?$/i);
  
  if (claudeMatch) { agentOverride = 'claude'; prompt = (claudeMatch[1] || '').trim(); }
  else if (cursorMatch) { agentOverride = 'cursor'; prompt = (cursorMatch[1] || '').trim(); }
  
  if (!prompt) prompt = 'Analyze the attached file(s) and summarize the contents.';

  const cwdResult = getAttachmentCwd(botCtx.chatId, agentOverride);
  if (cwdResult.error === 'no-project') {
    await botCtx.sendText(
      'Please attach files with `/claude ...` or `/cursor ...`, or activate a project first.',
    );
    return true;
  }
  if (cwdResult.error === 'project-missing') {
    await botCtx.sendText('Active project missing. Use /projects.');
    return true;
  }

  await botCtx.sendText(
    `📥 Downloading ${attachments.length} file${attachments.length === 1 ? '' : 's'}…`
  );
  botCtx.showTyping();

  const saved = await downloadAll(attachments, cwdResult.cwd);
  const bad = saved.filter((s) => !s.path && !s.tooLarge);
  const tooBig = saved.filter((s) => s.tooLarge);

  if (tooBig.length || bad.length) {
    const msgs = [
      ...tooBig.map((s) => `• ${s.fileName}: too large (${formatSize(s.size)} > 25 MB)`),
      ...bad.map((s) => `• ${s.fileName}: ${s.error || 'unknown error'}`),
    ];
    await botCtx.sendText(
      `⚠️ ${tooBig.length + bad.length} download issue${tooBig.length + bad.length === 1 ? '' : 's'}:\n${msgs.join('\n')}`
    );
  }

  await handleFiles(botCtx, saved, prompt, agentOverride);
  return true;
}

module.exports = { createBot };

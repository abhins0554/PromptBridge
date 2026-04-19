const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');
const { handleCommand, handleText, handleCallbackAction } = require('../../core/dispatcher');
const { GitHubContext } = require('./context');
const { make } = require('../../lib/logger');

const log = make('github');

function createBot() {
  const cfg = require('../../lib/config').get();

  if (!cfg.github?.token) {
    log.warn('GitHub token not configured');
    return { webhookHandler: null };
  }

  const octokit = new Octokit({
    auth: cfg.github.token,
  });

  /**
   * verifyWebhookSignature(payload, signature, secret) → boolean
   *
   * Verifies that the webhook payload was signed by GitHub.
   */
  function verifyWebhookSignature(payload, signature, secret) {
    if (!secret) return true; // Allow unsigned webhooks in dev
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(expected, signature);
  }

  /**
   * parseCommand(text) → {command, arg} | null
   *
   * Extracts /command and argument from text.
   * Examples: "/claude fix this" → {command: 'claude', arg: 'fix this'}
   */
  function parseCommand(text) {
    const match = text.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!match) return null;
    return { command: match[1], arg: (match[2] || '').trim() };
  }

  /**
   * isAllowed(userId, userName, cfg) → boolean
   *
   * Checks if the user is in the allowlist.
   */
  function isAllowed(userId, userName, cfg) {
    const allowedUserIds = (cfg.github?.rawAllowedUserIds || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowedUsers = (cfg.github?.allowedUsers || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Check ID first (O(1) if converted to Set, but for small lists it's fine)
    if (allowedUserIds.length && allowedUserIds.includes(String(userId))) return true;

    // Check username (case-insensitive)
    if (allowedUsers.length && allowedUsers.includes(String(userName).toLowerCase())) return true;

    // If allowlist is empty, deny by default
    return false;
  }

  /**
   * webhookHandler(req, res)
   *
   * Express middleware to handle GitHub webhooks.
   * Attached to POST /api/github/webhook
   */
  const webhookHandler = async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const body = req.rawBody || JSON.stringify(req.body);

    // Verify signature
    if (!verifyWebhookSignature(body, signature, cfg.github?.webhookSecret)) {
      log.warn('Invalid GitHub webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;

    // Only handle issue_comment and pull_request_review_comment events
    if (event.action !== 'created') {
      return res.status(200).json({ ok: true });
    }

    let owner, repo, issueNumber, commentId, userId, userName, commentText;

    if (event.issue) {
      // issue_comment event
      if (!event.comment) {
        return res.status(200).json({ ok: true });
      }
      owner = event.repository.owner.login;
      repo = event.repository.name;
      issueNumber = event.issue.number;
      commentId = event.comment.id;
      userId = event.comment.user.id;
      userName = event.comment.user.login;
      commentText = event.comment.body;
    } else if (event.pull_request) {
      // pull_request_review_comment event
      if (!event.comment) {
        return res.status(200).json({ ok: true });
      }
      owner = event.repository.owner.login;
      repo = event.repository.name;
      issueNumber = event.pull_request.number;
      commentId = event.comment.id;
      userId = event.comment.user.id;
      userName = event.comment.user.login;
      commentText = event.comment.body;
    } else {
      // Other events
      return res.status(200).json({ ok: true });
    }

    // Check allowlist
    const freshCfg = require('../../lib/config').get();
    if (!isAllowed(userId, userName, freshCfg)) {
      log.warn('user not allowed', { userName, userId });
      return res.status(200).json({ ok: true }); // Silent ignore
    }

    // Parse command
    const cmd = parseCommand(commentText);
    if (!cmd) {
      return res.status(200).json({ ok: true }); // Not a command
    }

    const ctx = new GitHubContext({
      octokit,
      owner,
      repo,
      issueNumber,
      commentId,
      userId,
      userName,
    });

    try {
      if (cmd.command === 'claude' || cmd.command === 'cursor') {
        // Treat as /claude or /cursor command with the argument
        await handleCommand(ctx, cmd.command, cmd.arg);
      } else {
        // Other commands (/projects, /help, etc.)
        await handleCommand(ctx, cmd.command, cmd.arg);
      }
    } catch (err) {
      log.error('github command failed', { err: err.message, command: cmd.command });
      try {
        await ctx.sendText(`❌ Error: ${err.message}`);
      } catch (sendErr) {
        log.error('error sending error message', { err: sendErr.message });
      }
    }

    res.status(200).json({ ok: true });
  };

  return { webhookHandler, octokit };
}

module.exports = { createBot };

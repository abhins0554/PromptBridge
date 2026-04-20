const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { make } = require('../../lib/logger');
const { runOnce } = require('../../core/dispatcher');
const { formatSize } = require('../../lib/format');
const { EmailContext, createMailer } = require('./index');

const log = make('email:inbound');

const INBOX = '.bot-inbox';
const MAX_ATTACH_BYTES = 25 * 1024 * 1024; // 25 MB

let client = null;
let running = false;
let retryTimer = null;
let retryCount = 0;

const BASE_RETRY_MS = 5000;
const MAX_RETRY_MS = 5 * 60 * 1000; // cap at 5 minutes

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f\\/]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

async function saveEmailAttachments(attachments, cwd) {
  const dest = path.join(cwd, INBOX);
  await fs.promises.mkdir(dest, { recursive: true });

  // Write .gitignore so these files are never committed
  const gitignore = path.join(dest, '.gitignore');
  try { await fs.promises.access(gitignore); } catch {
    try { await fs.promises.writeFile(gitignore, '# created by bot — attachments are never committed\n*\n'); } catch {}
  }

  const results = [];
  for (const att of attachments) {
    // Skip inline/embedded images (e.g. logos in email signatures)
    if (att.related) continue;

    const size = att.size || (att.content ? att.content.length : 0);
    if (size > MAX_ATTACH_BYTES) {
      results.push({ fileName: att.filename || 'file', size, tooLarge: true });
      continue;
    }

    try {
      const safe = sanitizeFilename(att.filename || 'attachment');
      const stamp = Date.now().toString(36);
      const fullPath = path.join(dest, `${stamp}-${safe}`);
      await fs.promises.writeFile(fullPath, att.content);
      results.push({
        fileName: safe,
        path: fullPath,
        size: att.content.length,
        mime: att.contentType || null,
      });
      log.info('saved email attachment', { file: safe, size: att.content.length });
    } catch (err) {
      log.warn('failed to save attachment', { file: att.filename, err: err.message });
      results.push({ fileName: att.filename || 'file', error: err.message });
    }
  }
  return results;
}

async function verifyImap(emailCfg) {
  const c = new ImapFlow({
    host: emailCfg.imapHost,
    port: Number(emailCfg.imapPort) || 993,
    secure: !!emailCfg.imapTls,
    auth: { user: emailCfg.imapUser, pass: emailCfg.imapPass },
    logger: false,
  });
  await c.connect();
  await c.logout();
  return true;
}

function scheduleRetry() {
  const delay = Math.min(BASE_RETRY_MS * Math.pow(2, retryCount), MAX_RETRY_MS);
  retryCount++;
  log.info('IMAP retry scheduled', { attempt: retryCount, delayMs: delay });
  retryTimer = setTimeout(startInboundListener, delay);
}

async function processNewMessages() {
  if (!client || !running) return;

  const config = require('../../lib/config').get();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || !uids.length) {
      log.debug('no unseen messages');
      return;
    }

    log.info('processing unseen messages', { count: uids.length });

    for (const uid of uids) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg?.source) continue;
        const parsed = await simpleParser(msg.source);
        // Mark seen immediately so crashes don't reprocess the same message
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        await handleInboundEmail(parsed, config);
      } catch (err) {
        log.warn('failed to process message', { uid, err: err.message });
      }
    }
  } finally {
    lock.release();
  }
}

async function handleInboundEmail(parsed, config) {
  const from = parsed.from?.value?.[0]?.address;
  const subject = parsed.subject || '(no subject)';
  const messageId = parsed.messageId;
  const body = (parsed.text || '').trim();

  log.info('inbound email', { from, subject });

  // Authorization check
  if (config.allowedEmails.length > 0) {
    if (!from || !config.allowedEmails.includes(from.toLowerCase())) {
      log.warn('unauthorized sender', { from });
      return;
    }
  }

  // Trigger pattern: "hi /claude <prompt>", "hi /cursor <prompt>", or "hi /codex <prompt>"
  // Prompt is optional when attachments are present
  const match = body.match(/hi\s+\/(claude|cursor|codex)(?:\s+([\s\S]+))?/i);
  if (!match) {
    log.info('no trigger found — needs: hi /claude <prompt>', { from });
    return;
  }

  const agent = match[1].toLowerCase();
  // Take only the first block before any email quote (lines starting with >)
  const rawPrompt = (match[2] || '').trim();
  const promptText = rawPrompt.split(/\n>/).shift().trim();

  // ── Save email attachments to disk (same folder as Telegram uses) ────────────
  const inboundAttachments = (parsed.attachments || []).filter(
    (a) => !a.related && a.content,
  );

  const cwd = config.freeformCwd;
  let saved = [];
  if (inboundAttachments.length) {
    log.info('saving email attachments', { count: inboundAttachments.length });
    saved = await saveEmailAttachments(inboundAttachments, cwd);

    const tooBig = saved.filter((s) => s.tooLarge);
    const failed = saved.filter((s) => s.error);
    if (tooBig.length)
      log.warn('attachments too large', { files: tooBig.map((s) => s.fileName) });
    if (failed.length)
      log.warn('attachments failed to save', { files: failed.map((s) => s.fileName) });
  }

  const ok = saved.filter((s) => s.path);

  // ── Build prompt (identical structure to dispatcher handleFiles) ─────────────
  let prompt;
  if (ok.length) {
    const fileLines = ok
      .map((f) => `- ${f.path} (${formatSize(f.size)}${f.mime ? `, ${f.mime}` : ''})`)
      .join('\n');
    const userPrompt = promptText || 'Analyze the attached file(s) and summarize the contents.';
    prompt =
      `The user attached ${ok.length} file${ok.length === 1 ? '' : 's'} via email. ` +
      `They are saved inside the working directory at:\n${fileLines}\n\n` +
      `Use your file-reading tools (Read, Bash, etc.) to open and analyze them as needed. ` +
      `Do not copy or duplicate them — read them in place.\n\n` +
      `User prompt: ${userPrompt}`;
  } else {
    if (!promptText) {
      log.info('no prompt and no attachments', { from });
      return;
    }
    prompt = promptText;
  }

  log.info('trigger matched', { agent, from, attachments: ok.length, prompt: prompt.slice(0, 80) });

  const chatId = `email:${from}`;
  const mailer = createMailer(config.email);
  const ctx = new EmailContext({
    chatId,
    mailer,
    to: from,
    from: config.email.smtpFrom || config.email.smtpUser,
    inReplyTo: messageId,
  });

  const runSubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

  try {
    await runOnce(ctx, { prompt, agent });
    await ctx.flush(runSubject);
    log.info('email reply sent', { to: from });
  } catch (err) {
    log.error('email run failed', { err: err.message });
    try {
      await ctx.sendText(`❌ Error: ${err.message}`);
      await ctx.flush(`Error: ${subject}`);
    } catch {}
  }
}

async function startInboundListener() {
  const config = require('../../lib/config').get();
  const { email } = config;

  if (!email.inboundEnabled || !email.imapHost) {
    log.info('inbound email disabled or not configured');
    return;
  }

  if (running) return;
  running = true;

  client = new ImapFlow({
    host: email.imapHost,
    port: Number(email.imapPort) || 993,
    secure: !!email.imapTls,
    auth: { user: email.imapUser, pass: email.imapPass },
    logger: false,
  });

  client.on('error', (err) => {
    log.error('IMAP error', { err: err.message });
    running = false;
    client = null;
    scheduleRetry();
  });

  try {
    await client.connect();
    log.info('IMAP connected', { user: email.imapUser });
    retryCount = 0; // reset backoff on successful connect

    // Process messages that arrived while we were offline
    await processNewMessages();

    // Fire on new message arrival during IDLE
    client.on('exists', () => {
      log.debug('exists event — checking for new mail');
      processNewMessages().catch((err) =>
        log.warn('processNewMessages error', { err: err.message }),
      );
    });

    // IDLE loop — keeps connection alive and receives server-push notifications
    while (running && client) {
      try {
        await client.idle();
      } catch (err) {
        if (running) log.warn('IDLE interrupted', { err: err.message });
        break;
      }
    }

    // IDLE loop exited cleanly — reconnect if still supposed to be running
    if (running) {
      running = false;
      client = null;
      scheduleRetry();
    }
  } catch (err) {
    log.error('IMAP error', { err: err.message });
    running = false;
    client = null;
    scheduleRetry();
  }
}

async function stopInboundListener() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryCount = 0;
  running = false;
  if (client) {
    try { await client.logout(); } catch {}
    client = null;
    log.info('IMAP disconnected');
  }
}

module.exports = { verifyImap, startInboundListener, stopInboundListener };

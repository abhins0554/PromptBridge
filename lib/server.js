const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { projects, sessions } = require('./store');
const { make } = require('./logger');
const { sanitizeModel, CLAUDE_PRESETS, CURSOR_PRESETS } = require('./models');
const { loadSettings, saveSettings, reload: reloadConfig } = require('./config');
const { runOnce } = require('../core/dispatcher');
const { EmailContext, createMailer, verifyMailer } = require('../platforms/email');

const log = make('http');

const BOT_ROOT = path.resolve(__dirname, '..');

const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_FAILS = 8;
const AUTH_LOCKOUT_MS = 10 * 60 * 1000;
const authFails = new Map();

function authGate(ip) {
  const rec = authFails.get(ip);
  if (!rec) return { allowed: true };
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return { allowed: false, retryAfter: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true };
}

function noteAuthFail(ip) {
  const now = Date.now();
  const rec = authFails.get(ip) || { count: 0, first: now, lockedUntil: 0 };
  if (now - rec.first > AUTH_WINDOW_MS) { rec.count = 1; rec.first = now; }
  else { rec.count++; }
  if (rec.count >= AUTH_MAX_FAILS) {
    rec.lockedUntil = now + AUTH_LOCKOUT_MS;
    log.warn('auth lockout', { ip, until: new Date(rec.lockedUntil).toISOString() });
  }
  authFails.set(ip, rec);
}

function clearAuthFails(ip) { authFails.delete(ip); }

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authFails) {
    if (rec.lockedUntil < now && now - rec.first > AUTH_WINDOW_MS) authFails.delete(ip);
  }
}, 60_000).unref();

function validateCwd(raw) {
  if (!raw || typeof raw !== 'string') return { error: 'cwd is required' };
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'cwd is required' };
  if (!path.isAbsolute(trimmed)) return { error: `cwd must be an absolute path (got "${trimmed}")` };
  const resolved = path.resolve(trimmed);
  if (resolved === BOT_ROOT || resolved.startsWith(BOT_ROOT + path.sep)) {
    return { error: 'cwd cannot be the bot directory or a subdirectory of it' };
  }
  if (!fs.existsSync(resolved)) return { error: `Working directory does not exist: ${resolved}` };
  try {
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return { error: `cwd is not a directory: ${resolved}` };
  } catch (err) {
    return { error: `cannot access cwd: ${err.message}` };
  }
  return { cwd: resolved };
}

function maskSettings(s) {
  const out = JSON.parse(JSON.stringify(s));
  if (out.email?.smtpPass) out.email.smtpPass = '***';
  if (out.email?.imapPass) out.email.imapPass = '***';
  if (out.telegram?.botToken) out.telegram.botToken = out.telegram.botToken.slice(0, 10) + '***';
  if (out.discord?.botToken) out.discord.botToken = out.discord.botToken.slice(0, 10) + '***';
  if (out.slack?.botToken) out.slack.botToken = out.slack.botToken.slice(0, 10) + '***';
  if (out.slack?.appToken) out.slack.appToken = out.slack.appToken.slice(0, 10) + '***';
  if (out.teams?.appPassword) out.teams.appPassword = out.teams.appPassword.slice(0, 10) + '***';
  return out;
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function createServer({ getStatus, restartPlatforms } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use((req, _res, next) => {
    req._rid = crypto.randomBytes(4).toString('hex');
    log.debug('req', { rid: req._rid, m: req.method, u: req.url });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  const publicRoutes = new Set(['/api/status']);

  function requireAuth(req, res, next) {
    const token = require('./config').get().dashboardToken;
    if (!token) return next();
    if (publicRoutes.has(req.path)) return next();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const gate = authGate(ip);
    if (!gate.allowed) {
      res.set('Retry-After', String(gate.retryAfter));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${gate.retryAfter}s.` });
    }
    const hdr = req.get('authorization') || '';
    const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    const provided = (req.get('x-dashboard-token') || bearer || req.query.token || '').toString();
    if (!provided || !timingSafeEqual(provided, token)) {
      noteAuthFail(ip);
      return res.status(401).json({ error: 'Unauthorized — set Authorization: Bearer <token> or ?token=' });
    }
    clearAuthFails(ip);
    next();
  }

  app.use('/api', requireAuth);

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/status', (_req, res) => {
    const cfg = require('./config').get();
    const status = typeof getStatus === 'function' ? getStatus() : {};
    res.json({
      ok: true,
      authRequired: !!cfg.dashboardToken,
      version: require('../package.json').version,
      uptimeSec: Math.floor(process.uptime()),
      emailEnabled: !!cfg.email?.enabled,
      telegramConfigured: !!cfg.botToken,
      discordConfigured: !!cfg.discord?.botToken,
      slackConfigured: !!cfg.slack?.botToken && !!cfg.slack?.appToken,
      ...status,
    });
  });

  // ── Projects ────────────────────────────────────────────────────────────────
  app.get('/api/projects', (_req, res) => res.json(projects.list()));

  app.post('/api/projects', (req, res) => {
    const { name, cwd, agent, systemPrompt, model } = req.body || {};
    if (!name || !cwd || !agent) return res.status(400).json({ error: 'name, cwd, agent are required' });
    if (!['claude', 'cursor'].includes(agent)) return res.status(400).json({ error: 'agent must be "claude" or "cursor"' });
    const v = validateCwd(cwd);
    if (v.error) return res.status(400).json({ error: v.error });
    const resolvedModel = model ? sanitizeModel(model) : null;
    if (model && resolvedModel === null) return res.status(400).json({ error: 'model contains invalid characters' });
    try {
      const p = projects.create({ name: name.trim(), cwd: v.cwd, agent, systemPrompt: systemPrompt || '', model: resolvedModel || '' });
      res.json(p);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.put('/api/projects/:id', (req, res) => {
    const { cwd, agent, model } = req.body || {};
    if (agent && !['claude', 'cursor'].includes(agent)) return res.status(400).json({ error: 'agent must be "claude" or "cursor"' });
    const patch = { ...req.body };
    if (cwd !== undefined) {
      const v = validateCwd(cwd);
      if (v.error) return res.status(400).json({ error: v.error });
      patch.cwd = v.cwd;
    }
    if (model !== undefined) {
      if (!model || !String(model).trim()) { patch.model = ''; }
      else {
        const m = sanitizeModel(model);
        if (!m) return res.status(400).json({ error: 'model contains invalid characters' });
        patch.model = m;
      }
    }
    try {
      const updated = projects.update(req.params.id, patch);
      if (!updated) return res.status(404).json({ error: 'Project not found' });
      res.json(updated);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.delete('/api/projects/:id', (req, res) => {
    projects.remove(req.params.id);
    sessions.clearForProject(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/models', (_req, res) => res.json({ claude: CLAUDE_PRESETS, cursor: CURSOR_PRESETS }));

  // ── Sessions ────────────────────────────────────────────────────────────────
  app.get('/api/sessions', (_req, res) => res.json(sessions.all()));

  app.delete('/api/sessions/:chatId/:projectId', (req, res) => {
    sessions.reset(req.params.chatId, req.params.projectId);
    res.json({ ok: true });
  });

  // ── Settings ────────────────────────────────────────────────────────────────
  app.get('/api/settings', (_req, res) => {
    res.json(maskSettings(loadSettings()));
  });

  app.put('/api/settings', (req, res) => {
    const patch = req.body || {};

    // Validate permissionMode if provided
    if (patch.permissionMode && !['default', 'plan', 'acceptEdits', 'bypassPermissions'].includes(patch.permissionMode)) {
      return res.status(400).json({ error: 'invalid permissionMode' });
    }

    // Preserve masked sentinel values — don't overwrite stored secrets with the mask string
    const existing = loadSettings();
    if (patch.email?.smtpPass === '***') {
      patch.email.smtpPass = existing.email?.smtpPass || '';
    }
    if (patch.email?.imapPass === '***') {
      patch.email.imapPass = existing.email?.imapPass || '';
    }
    if (patch.telegram?.botToken?.includes('***')) {
      if (patch.telegram) patch.telegram.botToken = existing.telegram?.botToken || '';
    }
    if (patch.discord?.botToken?.includes('***')) {
      if (patch.discord) patch.discord.botToken = existing.discord?.botToken || '';
    }
    if (patch.slack?.botToken?.includes('***')) {
      if (patch.slack) patch.slack.botToken = existing.slack?.botToken || '';
    }
    if (patch.slack?.appToken?.includes('***')) {
      if (patch.slack) patch.slack.appToken = existing.slack?.appToken || '';
    }
    if (patch.teams?.appPassword?.includes('***')) {
      if (patch.teams) patch.teams.appPassword = existing.teams?.appPassword || '';
    }

    // Validate freeformCwd if provided
    if (patch.freeformCwd && patch.freeformCwd.trim()) {
      const trimmed = patch.freeformCwd.trim();
      if (!path.isAbsolute(trimmed)) {
        return res.status(400).json({ error: 'freeformCwd must be an absolute path' });
      }
      patch.freeformCwd = trimmed;
    }

    const platformChanged =
      patch.telegram !== undefined ||
      patch.discord !== undefined ||
      patch.slack !== undefined ||
      patch.teams !== undefined;

    try {
      const updated = saveSettings(patch);
      reloadConfig();
      if (platformChanged && typeof restartPlatforms === 'function') {
        setImmediate(restartPlatforms);
      }
      res.json(maskSettings(updated));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Email connection test ────────────────────────────────────────────────────
  app.post('/api/settings/email/test', async (req, res) => {
    const cfg = require('./config').get();
    if (!cfg.email?.smtpHost) {
      return res.status(400).json({ error: 'SMTP not configured. Save settings first.' });
    }
    try {
      await verifyMailer(cfg.email);
      res.json({ ok: true, message: 'SMTP connection verified.' });
    } catch (err) {
      res.status(400).json({ error: `SMTP connection failed: ${err.message}` });
    }
  });

  // ── IMAP connection test ────────────────────────────────────────────────────
  app.post('/api/settings/imap/test', async (req, res) => {
    const cfg = require('./config').get();
    if (!cfg.email?.imapHost) {
      return res.status(400).json({ error: 'IMAP not configured. Save settings first.' });
    }
    const { verifyImap } = require('../platforms/email/inbound');
    try {
      await verifyImap(cfg.email);
      res.json({ ok: true, message: 'IMAP connection verified.' });
    } catch (err) {
      res.status(400).json({ error: `IMAP connection failed: ${err.message}` });
    }
  });

  // ── Email run ───────────────────────────────────────────────────────────────
  app.post('/api/run/email', (req, res) => {
    const cfg = require('./config').get();
    if (!cfg.email?.enabled) {
      return res.status(400).json({ error: 'Email is not enabled. Enable it in Settings.' });
    }
    if (!cfg.email?.smtpHost) {
      return res.status(400).json({ error: 'SMTP not configured. Set it in Settings.' });
    }

    const { projectId, prompt, to, agent } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt is required' });
    if (!to || !to.trim()) return res.status(400).json({ error: 'to (email address) is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
      return res.status(400).json({ error: 'invalid email address' });
    }

    const p = projectId ? projects.get(projectId) : null;
    if (projectId && !p) return res.status(404).json({ error: 'Project not found' });

    const recipient = to.trim();
    const subject = p ? `PromptBridge: ${p.name}` : 'PromptBridge: Q&A Response';
    const chatId = `email:${recipient}:${Date.now()}`;
    const mailer = createMailer(cfg.email);
    const ctx = new EmailContext({ chatId, mailer, to: recipient, from: cfg.email.smtpFrom || cfg.email.smtpUser });

    // Respond immediately; email is sent asynchronously after the run
    res.json({ ok: true, message: `Running — result will be emailed to ${recipient}` });

    runOnce(ctx, { projectId: p?.id || null, prompt: prompt.trim(), agent: agent || null })
      .then(() => ctx.flush(subject))
      .catch(async (err) => {
        log.error('email run failed', { err: err.message });
        try {
          await ctx.flush(`PromptBridge: Error`);
        } catch {}
        try {
          await mailer.sendMail({
            from: cfg.email.smtpFrom || cfg.email.smtpUser,
            to: recipient,
            subject: 'PromptBridge: Run Failed',
            text: `Your agent run failed:\n\n${err.message}`,
          });
        } catch {}
      });
  });

  // ── Error handler ───────────────────────────────────────────────────────────
  app.use((err, req, res, _next) => {
    log.error('unhandled', { rid: req._rid, err: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createServer };

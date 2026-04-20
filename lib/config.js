const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ─── Settings persistence (dashboard-configured values) ──────────────────────

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const current = loadSettings();
  const updated = deepMerge(current, patch);
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, SETTINGS_FILE);
  return updated;
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Config loading ────────────────────────────────────────────────────────────

function parseList(raw, transform = (s) => s) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(transform);
}

function parsePositiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function load() {
  // s = settings from dashboard (data/settings.json)
  const s = loadSettings();
  const errors = [];

  // Telegram config — settings.json takes precedence over .env (env kept for migration only)
  const tg = s.telegram || {};
  const botToken = (tg.botToken || process.env.BOT_TOKEN || '').trim();

  const allowedUsernames = parseList(
    tg.allowedUsers || process.env.ALLOWED_USERS,
    (u) => u.replace(/^@/, '').toLowerCase(),
  );
  const allowedUserIds = parseList(
    tg.allowedUserIds || process.env.ALLOWED_USER_IDS,
    Number,
  ).filter((n) => Number.isFinite(n) && n > 0);

  // Discord config — settings.json takes precedence over .env (env kept for bootstrap)
  const dc = s.discord || {};
  const discordBotToken = (dc.botToken || process.env.DISCORD_BOT_TOKEN || '').trim();
  const discordAllowedUsernames = parseList(
    dc.allowedUsers || process.env.DISCORD_ALLOWED_USERS,
    (u) => u.replace(/^@/, '').toLowerCase(),
  );
  const discordAllowedUserIds = parseList(
    dc.allowedUserIds || process.env.DISCORD_ALLOWED_USER_IDS,
    (u) => String(u).trim(),
  ).filter(Boolean);

  // Slack config — Socket Mode with bot token + app token
  const sl = s.slack || {};
  const slackBotToken = (sl.botToken || process.env.SLACK_BOT_TOKEN || '').trim();
  const slackAppToken = (sl.appToken || process.env.SLACK_APP_TOKEN || '').trim();
  const slackAllowedUsernames = parseList(
    sl.allowedUsers || process.env.SLACK_ALLOWED_USERS,
    (u) => u.replace(/^@/, '').toLowerCase(),
  );
  const slackAllowedUserIds = parseList(
    sl.allowedUserIds || process.env.SLACK_ALLOWED_USER_IDS,
    (u) => String(u).trim(),
  ).filter(Boolean);

  // Teams config — settings.json takes precedence over .env
  const tm = s.teams || {};
  const teamsAppId = (tm.appId || process.env.TEAMS_APP_ID || '').trim();
  const teamsAppPassword = (tm.appPassword || process.env.TEAMS_APP_PASSWORD || '').trim();
  const teamsAllowedUsernames = parseList(
    tm.allowedUsers || process.env.TEAMS_ALLOWED_USERS,
    (u) => u.replace(/^@/, '').toLowerCase(),
  );
  const teamsAllowedUserIds = parseList(
    tm.allowedUserIds || process.env.TEAMS_ALLOWED_USER_IDS,
    (u) => String(u).trim(),
  ).filter(Boolean);

  // GitHub config — settings.json takes precedence over .env
  const gh = s.github || {};
  const githubToken = (gh.token || process.env.GITHUB_TOKEN || '').trim();
  const githubWebhookSecret = (gh.webhookSecret || process.env.GITHUB_WEBHOOK_SECRET || '').trim();
  const githubAllowedRepos = parseList(
    gh.allowedRepos || process.env.GITHUB_ALLOWED_REPOS,
  );
  const githubAllowedUsers = parseList(
    gh.allowedUsers || process.env.GITHUB_ALLOWED_USERS,
    (u) => u.replace(/^@/, '').toLowerCase(),
  );
  const githubAllowedUserIds = parseList(
    gh.allowedUserIds || process.env.GITHUB_ALLOWED_USER_IDS,
    (u) => String(u).trim(),
  ).filter(Boolean);

  const allowedEmails = parseList(s.allowedEmails || process.env.ALLOWED_EMAILS, (e) =>
    e.toLowerCase().trim(),
  );

  const port = parsePositiveInt(process.env.PORT, 3000);

  // Dashboard token: env only (settings.json is readable by anyone with FS access)
  const dashboardToken = (process.env.DASHBOARD_TOKEN || '').trim();

  // Runtime config: settings.json takes precedence over .env
  const agentTimeoutMs =
    s.agentTimeoutMs || parsePositiveInt(process.env.AGENT_TIMEOUT_MS, 60 * 60 * 1000);
  const claudeCmd = s.claudeCmd || process.env.CLAUDE_CMD || 'claude';
  const cursorCmd = s.cursorCmd || process.env.CURSOR_CMD || 'cursor-agent';
  const cursorModel = s.cursorModel || process.env.CURSOR_MODEL || 'auto';
  const permissionMode =
    s.permissionMode || process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions';
  const freeformCwd =
    s.freeformCwd ||
    (process.env.FREEFORM_CWD || '').trim() ||
    path.join(__dirname, '..', 'data', 'scratch');
  const logLevel = (s.logLevel || process.env.LOG_LEVEL || 'info').toLowerCase();
  const dashboardUrl =
    s.dashboardUrl ||
    (process.env.DASHBOARD_URL || '').trim() ||
    `http://localhost:${port}`;

  // Email config — only from settings.json (configured via dashboard)
  const email = s.email || {};

  if (!['default', 'plan', 'acceptEdits', 'bypassPermissions'].includes(permissionMode)) {
    errors.push(`permissionMode invalid: "${permissionMode}"`);
  }
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    errors.push(`logLevel must be debug|info|warn|error (got "${logLevel}")`);
  }

  return {
    errors,
    botToken,
    allowedUsernames,
    allowedUserIds,
    discord: {
      botToken: discordBotToken,
      allowedUsernames: discordAllowedUsernames,
      allowedUserIds: discordAllowedUserIds,
      allowedUsers: dc.allowedUsers || process.env.DISCORD_ALLOWED_USERS || '',
      rawAllowedUserIds: dc.allowedUserIds || process.env.DISCORD_ALLOWED_USER_IDS || '',
    },
    slack: {
      botToken: slackBotToken,
      appToken: slackAppToken,
      allowedUsernames: slackAllowedUsernames,
      allowedUserIds: slackAllowedUserIds,
      allowedUsers: sl.allowedUsers || process.env.SLACK_ALLOWED_USERS || '',
      allowedUserIdsRaw: sl.allowedUserIds || process.env.SLACK_ALLOWED_USER_IDS || '',
    },
    teams: {
      appId: teamsAppId,
      appPassword: teamsAppPassword,
      allowedUsernames: teamsAllowedUsernames,
      allowedUserIds: teamsAllowedUserIds,
      allowedUsers: tm.allowedUsers || process.env.TEAMS_ALLOWED_USERS || '',
      rawAllowedUserIds: tm.allowedUserIds || process.env.TEAMS_ALLOWED_USER_IDS || '',
    },
    github: {
      token: githubToken,
      webhookSecret: githubWebhookSecret,
      allowedRepos: githubAllowedRepos,
      allowedUsernames: githubAllowedUsers,
      allowedUserIds: githubAllowedUserIds,
      allowedUsers: gh.allowedUsers || process.env.GITHUB_ALLOWED_USERS || '',
      rawAllowedUserIds: gh.allowedUserIds || process.env.GITHUB_ALLOWED_USER_IDS || '',
    },
    port,
    agentTimeoutMs,
    dashboardUrl,
    dashboardToken,
    logLevel,
    claudeCmd,
    cursorCmd,
    cursorModel,
    permissionMode,
    freeformCwd,
    email,
    allowedEmails,
  };
}

// ─── Cache with TTL so hot-reload works within a few seconds ─────────────────

let cached = null;
let cachedAt = 0;
const TTL_MS = 3000;

function get() {
  if (!cached || Date.now() - cachedAt > TTL_MS) {
    cached = load();
    cachedAt = Date.now();
  }
  return cached;
}

function reload() {
  cached = null;
  cachedAt = 0;
  return get();
}

module.exports = { get, load, reload, loadSettings, saveSettings };

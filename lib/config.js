const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
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

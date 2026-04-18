const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT =
  LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function format(level, scope, msg, meta) {
  const base = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (!meta || Object.keys(meta).length === 0) return base;
  const parts = [];
  for (const [k, v] of Object.entries(meta)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${k}=${s}`);
  }
  return `${base} ${parts.join(' ')}`;
}

function write(level, scope, msg, meta) {
  if (LEVELS[level] < CURRENT) return;
  const line = format(level, scope, msg, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function make(scope) {
  return {
    debug: (msg, meta) => write('debug', scope, msg, meta),
    info: (msg, meta) => write('info', scope, msg, meta),
    warn: (msg, meta) => write('warn', scope, msg, meta),
    error: (msg, meta) => write('error', scope, msg, meta),
    child: (sub) => make(`${scope}:${sub}`),
  };
}

module.exports = { logger: make('bot'), make };

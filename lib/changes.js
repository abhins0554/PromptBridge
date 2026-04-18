const fs = require('fs');
const path = require('path');
const spawn = require('cross-spawn');

const MAX_FILES = 30;
const MAX_WALK_ENTRIES = 8000;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.turbo',
  'coverage', '.cache', '.parcel-cache', '.vite', 'out', '.svelte-kit',
  '.bot-inbox',
]);
const INBOX_PREFIX_RE = /^\.bot-inbox[\\/]/;
const ATTACHABLE_EXTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff',
  'zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar',
  'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp',
  'mp3', 'mp4', 'wav', 'ogg', 'oga', 'webm', 'mov', 'mkv', 'flac', 'm4a',
  'csv', 'tsv', 'html', 'htm',
]);
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

function git(cwd, args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('git timed out'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || `git exited ${code}`));
      resolve(stdout);
    });
  });
}

function isGitRepo(cwd) {
  return fs.existsSync(path.join(cwd, '.git'));
}

async function snapshot(cwd) {
  if (isGitRepo(cwd)) {
    try {
      const status = await git(cwd, ['status', '--porcelain']);
      return { kind: 'git', status };
    } catch {}
  }
  return { kind: 'mtime', startedAt: Date.now() };
}

async function mtimeChanges(cwd, since) {
  const changed = [];
  let visited = 0;
  const stack = [cwd];
  while (stack.length) {
    if (visited > MAX_WALK_ENTRIES) break;
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      visited++;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          if (st.mtimeMs > since) changed.push(path.relative(cwd, full));
        } catch {}
      }
    }
  }
  return changed;
}

function trunc(items, max = MAX_FILES) {
  if (items.length <= max) return items.join('\n');
  return items.slice(0, max).join('\n') + `\n... and ${items.length - max} more`;
}

function parsePorcelainFiles(status) {
  const files = [];
  for (const line of status.split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    if (code === ' D' || code === 'D ' || code === 'DD') continue;
    let file = line.slice(3);
    if (file.startsWith('"')) continue;
    const arrow = file.indexOf(' -> ');
    if (arrow >= 0) file = file.slice(arrow + 4);
    if (INBOX_PREFIX_RE.test(file)) continue;
    files.push(file);
  }
  return files;
}

async function collectArtifacts(cwd, baseline) {
  if (!baseline) return [];
  let candidates = [];
  if (baseline.kind === 'git') {
    try {
      const after = await git(cwd, ['status', '--porcelain']);
      candidates = parsePorcelainFiles(after);
    } catch {
      return [];
    }
  } else {
    candidates = await mtimeChanges(cwd, baseline.startedAt);
  }

  const results = [];
  const seen = new Set();
  for (const rel of candidates) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!ATTACHABLE_EXTS.has(ext)) continue;
    const full = path.join(cwd, rel);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (st.size === 0) continue;
      if (st.size > MAX_ATTACHMENT_BYTES) {
        results.push({ path: full, rel, name: path.basename(rel), size: st.size, ext, tooLarge: true });
      } else {
        results.push({ path: full, rel, name: path.basename(rel), size: st.size, ext, tooLarge: false });
      }
      if (results.length >= MAX_ATTACHMENTS) break;
    } catch {}
  }
  return results;
}

async function diffFromSnapshot(cwd, baseline) {
  if (baseline.kind === 'git') {
    try {
      const after = await git(cwd, ['status', '--porcelain']);
      if (after === baseline.status) return null;
      const lines = after
        .split('\n')
        .filter(Boolean)
        .filter((l) => !INBOX_PREFIX_RE.test(l.slice(3)));
      if (!lines.length) return null;
      let stat = '';
      try { stat = (await git(cwd, ['diff', '--stat', 'HEAD'])).trim(); } catch {}
      let out = `Changes (working tree):\n${trunc(lines)}`;
      if (stat) out += `\n\n${stat}`;
      return out;
    } catch {
      return null;
    }
  }
  const files = await mtimeChanges(cwd, baseline.startedAt);
  if (!files.length) return null;
  return `${files.length} file(s) changed:\n${trunc(files)}`;
}

module.exports = { snapshot, diffFromSnapshot, collectArtifacts };

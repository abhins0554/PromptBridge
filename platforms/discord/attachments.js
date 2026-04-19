const fs = require('fs');
const path = require('path');
const { make } = require('../../lib/logger');

const log = make('discord:attachments');

const INBOX = '.bot-inbox';
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f\\/]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

async function ensureInbox(cwd) {
  const dest = path.join(cwd, INBOX);
  await fs.promises.mkdir(dest, { recursive: true });
  const gitignore = path.join(dest, '.gitignore');
  try {
    await fs.promises.access(gitignore);
  } catch {
    try {
      await fs.promises.writeFile(
        gitignore,
        '# created by bot — attachments are never committed\n*\n',
      );
    } catch {}
  }
  return dest;
}

function extractAttachments(message) {
  return [...message.attachments.values()].map((att) => ({
    url: att.url,
    fileName: att.name || `attachment-${Date.now()}`,
    size: att.size || 0,
    mime: att.contentType || null,
  }));
}

async function downloadAll(attachments, cwd) {
  const dest = await ensureInbox(cwd);
  const results = [];

  for (const att of attachments) {
    if (att.size && att.size > MAX_DOWNLOAD_BYTES) {
      results.push({ fileName: att.fileName, size: att.size, tooLarge: true });
      continue;
    }
    try {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const safe = sanitizeFilename(att.fileName);
      const stamp = Date.now().toString(36);
      const fullPath = path.join(dest, `${stamp}-${safe}`);
      await fs.promises.writeFile(fullPath, buf);
      results.push({
        fileName: safe,
        path: fullPath,
        relPath: path.join(INBOX, path.basename(fullPath)),
        size: buf.length,
        mime: att.mime,
      });
    } catch (err) {
      log.warn('download failed', { file: att.fileName, err: err.message });
      results.push({ fileName: att.fileName, error: err.message });
    }
  }

  return results;
}

module.exports = { extractAttachments, downloadAll };

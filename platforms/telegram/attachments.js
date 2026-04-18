const fs = require('fs');
const path = require('path');
const { make } = require('../../lib/logger');

const log = make('tg:attachments');

const INBOX = '.bot-inbox';
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB Telegram bot API download limit

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file'));
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f\\/]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

function extFromMime(m) {
  if (!m) return null;
  if (m.startsWith('audio/mpeg')) return 'mp3';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/wav')) return 'wav';
  if (m.startsWith('audio/ogg')) return 'ogg';
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.startsWith('video/webm')) return 'webm';
  if (m.startsWith('image/png')) return 'png';
  if (m.startsWith('image/gif')) return 'gif';
  if (m.startsWith('image/webp')) return 'webp';
  if (m.startsWith('application/pdf')) return 'pdf';
  return null;
}

/**
 * Extract a normalised attachment list from a Telegram message object.
 * Returns Array<{ fileId, fileName, size, mime }>.
 */
function extractAttachments(message) {
  const out = [];
  const stamp = Date.now();

  if (message.document) {
    out.push({
      fileId: message.document.file_id,
      fileName: message.document.file_name || `document-${stamp}`,
      size: message.document.file_size || 0,
      mime: message.document.mime_type || null,
    });
  }
  if (Array.isArray(message.photo) && message.photo.length) {
    const best = message.photo[message.photo.length - 1];
    out.push({
      fileId: best.file_id,
      fileName: `photo-${stamp}.jpg`,
      size: best.file_size || 0,
      mime: 'image/jpeg',
    });
  }
  if (message.voice) {
    out.push({
      fileId: message.voice.file_id,
      fileName: `voice-${stamp}.ogg`,
      size: message.voice.file_size || 0,
      mime: message.voice.mime_type || 'audio/ogg',
    });
  }
  if (message.audio) {
    const ext = extFromMime(message.audio.mime_type) || 'mp3';
    out.push({
      fileId: message.audio.file_id,
      fileName: message.audio.file_name || `audio-${stamp}.${ext}`,
      size: message.audio.file_size || 0,
      mime: message.audio.mime_type || null,
    });
  }
  if (message.video) {
    out.push({
      fileId: message.video.file_id,
      fileName: message.video.file_name || `video-${stamp}.mp4`,
      size: message.video.file_size || 0,
      mime: message.video.mime_type || 'video/mp4',
    });
  }
  if (message.video_note) {
    out.push({
      fileId: message.video_note.file_id,
      fileName: `video-note-${stamp}.mp4`,
      size: message.video_note.file_size || 0,
      mime: 'video/mp4',
    });
  }
  if (message.sticker?.file_id) {
    out.push({
      fileId: message.sticker.file_id,
      fileName: `sticker-${stamp}.webp`,
      size: message.sticker.file_size || 0,
      mime: 'image/webp',
    });
  }

  return out;
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

/**
 * Download Telegram attachments to disk.
 *
 * @param {(fileId: string) => Promise<string|URL>} getFileLink
 *   Function that resolves a Telegram file_id to a download URL.
 *   Pass `(id) => ctx.telegram.getFileLink(id)` from the Telegraf context.
 * @param {Array<{fileId, fileName, size, mime}>} attachments
 * @param {string} cwd  Absolute path to the project / scratch directory.
 * @returns {Promise<Array<{fileName, path?, relPath?, size, mime?, tooLarge?, error?}>>}
 */
async function downloadAll(getFileLink, attachments, cwd) {
  const dest = await ensureInbox(cwd);
  const results = [];

  for (const att of attachments) {
    if (att.size && att.size > MAX_DOWNLOAD_BYTES) {
      results.push({ fileName: att.fileName, size: att.size, tooLarge: true });
      continue;
    }
    try {
      const link = await getFileLink(att.fileId);
      const url = typeof link === 'string' ? link : link.href;
      const res = await fetch(url);
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

module.exports = { extractAttachments, downloadAll, INBOX };

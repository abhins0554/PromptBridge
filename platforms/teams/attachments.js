const fs = require('fs');
const path = require('path');
const https = require('https');
const { make } = require('../../lib/logger');

const log = make('teams:attachments');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Extract attachments from a Teams activity.
 * Handles files uploaded to Teams channels.
 */
function extractAttachments(activity) {
  const attachments = [];
  
  if (!activity.attachments || !Array.isArray(activity.attachments)) {
    return attachments;
  }

  for (const att of activity.attachments) {
    // Teams attachments can have contentUrl or contentBlobUrl
    const url = att.contentUrl || att.contentBlobUrl;
    if (!url) continue;

    attachments.push({
      fileName: att.name || 'file',
      contentUrl: url,
      size: att.size,
      contentType: att.contentType || 'application/octet-stream',
    });
  }

  return attachments;
}

/**
 * Download all attachments from Teams.
 * Teams attachments typically require auth headers.
 */
async function downloadAll(attachments, cwd) {
  const results = [];

  for (const att of attachments) {
    try {
      const result = await downloadAttachment(att, cwd);
      results.push(result);
    } catch (err) {
      log.warn('download failed', { fileName: att.fileName, err: err.message });
      results.push({
        fileName: att.fileName,
        path: null,
        error: err.message,
        tooLarge: false,
      });
    }
  }

  return results;
}

/**
 * Download a single Teams attachment.
 */
async function downloadAttachment(att, cwd) {
  const size = att.size || 0;
  
  // Check size before attempting download
  if (size > MAX_FILE_SIZE) {
    log.warn('attachment too large', { fileName: att.fileName, size });
    return {
      fileName: att.fileName,
      path: null,
      tooLarge: true,
      size,
    };
  }

  return new Promise((resolve, reject) => {
    try {
      const fileName = sanitizeFileName(att.fileName);
      const filePath = path.join(cwd, fileName);
      const writeStream = fs.createWriteStream(filePath);
      let downloadedSize = 0;

      const protocol = att.contentUrl.startsWith('https') ? https : require('http');
      
      protocol.get(att.contentUrl, (response) => {
        // Check Content-Length header
        const contentLength = parseInt(response.headers['content-length'], 10);
        if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE) {
          writeStream.destroy();
          fs.unlink(filePath, () => {});
          return reject(new Error('Content too large'));
        }

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (downloadedSize > MAX_FILE_SIZE) {
            writeStream.destroy();
            fs.unlink(filePath, () => {});
            reject(new Error('Download exceeded size limit'));
          }
        });

        response.pipe(writeStream);
        writeStream.on('finish', () => {
          resolve({
            fileName: att.fileName,
            path: filePath,
            tooLarge: false,
          });
        });

        writeStream.on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      }).on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function sanitizeFileName(name) {
  // Remove path traversal and special characters
  return name.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 255);
}

module.exports = {
  extractAttachments,
  downloadAll,
};

/**
 * GitHub attachments handler
 *
 * GitHub webhooks can include file references, but actual file content
 * comes from the issue/PR body or can be fetched from the repository.
 *
 * For now, this module provides utilities to extract file references
 * from issue/PR descriptions.
 */

function extractAttachments(event) {
  /**
   * GitHub doesn't have file attachments like Telegram or Discord.
   * Instead, users would reference files in the issue/PR description.
   *
   * Example: "Fix the bug in src/main.py"
   *
   * The dispatcher can handle file references within the prompt text
   * using its existing file-reading capabilities.
   */
  return [];
}

module.exports = { extractAttachments };

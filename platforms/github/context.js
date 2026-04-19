const { BotContext } = require('../../core/context');
const { Octokit } = require('@octokit/rest');

class GitHubContext extends BotContext {
  constructor({ octokit, owner, repo, issueNumber, commentId, userId, userName }) {
    super();
    this._octokit = octokit;
    this._owner = owner;
    this._repo = repo;
    this._issueNumber = issueNumber;
    this._commentId = commentId;
    this._userId = userId;
    this._userName = userName;
    this._messages = [];
  }

  get chatId() {
    return `github:${this._owner}/${this._repo}#${this._issueNumber}`;
  }

  get platform() {
    return 'github';
  }

  get canEditMessages() {
    return true;
  }

  get canUseButtons() {
    return false;
  }

  async sendMarkdown(md) {
    const comment = await this._octokit.rest.issues.createComment({
      owner: this._owner,
      repo: this._repo,
      issue_number: this._issueNumber,
      body: md,
    });
    return comment.data.id;
  }

  async sendText(text) {
    return this.sendMarkdown(text);
  }

  async editMessage(messageId, md) {
    if (!messageId) return;
    await this._octokit.rest.issues.updateComment({
      owner: this._owner,
      repo: this._repo,
      comment_id: messageId,
      body: md,
    });
    return messageId;
  }

  async sendFile(filePath, caption) {
    // GitHub doesn't support direct file uploads to comments
    // Instead, render the file content as a code block
    const fs = require('fs');
    const path = require('path');

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).slice(1) || 'txt';

      const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n... (truncated)' : content;

      let md = caption ? `**${caption}**\n\n` : '';
      md += `\`\`\`${ext}\n${truncated}\n\`\`\``;

      return this.sendMarkdown(md);
    } catch (err) {
      return this.sendMarkdown(
        `Could not attach file: ${err.message}\n` +
        `Path: \`${filePath}\``
      );
    }
  }

  async sendWithButtons(md, buttonRows) {
    // GitHub doesn't support interactive buttons, just post the markdown
    return this.sendMarkdown(md);
  }

  async acknowledgeAction(text) {
    // No action acknowledgment needed for GitHub
  }

  async updateButtonMessage(md, buttonRows) {
    // No button updates for GitHub
  }

  async showTyping() {
    // GitHub doesn't have a typing indicator
  }
}

module.exports = { GitHubContext };

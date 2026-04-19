const { Octokit } = require('@octokit/rest');
const { handleCommand } = require('../../core/dispatcher');
const { GitHubContext } = require('./context');
const { markProcessed, isProcessed } = require('../../lib/github-state');
const { make } = require('../../lib/logger');

const log = make('github-polling');

let pollingInterval = null;
let isRunning = false;

function parseCommand(text) {
  const match = text.match(/^\/(\w+)(?:\s+(.*))?$/m);
  if (!match) return null;
  return { command: match[1], arg: (match[2] || '').trim() };
}

function isAllowed(userId, userName, cfg) {
  const allowedUserIds = (cfg.github?.rawAllowedUserIds || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedUsers = (cfg.github?.allowedUsers || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  if (allowedUserIds.length && allowedUserIds.includes(String(userId))) return true;
  if (allowedUsers.length && allowedUsers.includes(String(userName).toLowerCase())) return true;
  return false;
}

async function checkComments() {
  const cfg = require('../../lib/config').get();
  if (!cfg.github?.token) return;

  const octokit = new Octokit({ auth: cfg.github.token });

  try {
    // Get all repositories the token has access to
    let page = 1;
    const processedThisRun = [];

    while (page <= 3) {
      const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
        page,
        sort: 'updated',
      }).catch(() => ({ data: [] }));

      if (!repos.length) break;

      for (const repo of repos) {
        try {
          // Check issue comments
          const { data: issueComments } = await octokit.rest.issues.listComments({
            owner: repo.owner.login,
            repo: repo.name,
            sort: 'updated',
            direction: 'desc',
            per_page: 10,
          }).catch(() => ({ data: [] }));

          for (const comment of issueComments) {
            if (isProcessed(comment.id)) continue;

            const cmd = parseCommand(comment.body);
            if (!cmd || !['claude', 'cursor'].includes(cmd.command)) continue;

            if (!isAllowed(comment.user.id, comment.user.login, cfg)) {
              markProcessed(comment.id);
              continue;
            }

            // Get the issue number from the comment URL or from issue lookup
            const { data: issue } = await octokit.rest.issues.get({
              owner: repo.owner.login,
              repo: repo.name,
              issue_number: comment.issue_url.split('/').pop(),
            }).catch(() => ({ data: { number: null } }));

            if (!issue.number) continue;

            const ctx = new GitHubContext({
              octokit,
              owner: repo.owner.login,
              repo: repo.name,
              issueNumber: issue.number,
              commentId: comment.id,
              userId: comment.user.id,
              userName: comment.user.login,
            });

            try {
              await handleCommand(ctx, cmd.command, cmd.arg);
              processedThisRun.push(comment.id);
            } catch (err) {
              log.error('command failed', { err: err.message, owner: repo.owner.login, repo: repo.name });
              try {
                await ctx.sendText(`❌ Error: ${err.message}`);
              } catch {}
            }

            markProcessed(comment.id);
          }

          // Check PR review comments
          const { data: prComments } = await octokit.rest.pulls.listComments({
            owner: repo.owner.login,
            repo: repo.name,
            sort: 'updated',
            direction: 'desc',
            per_page: 10,
          }).catch(() => ({ data: [] }));

          for (const comment of prComments) {
            if (isProcessed(comment.id)) continue;

            const cmd = parseCommand(comment.body);
            if (!cmd || !['claude', 'cursor'].includes(cmd.command)) continue;

            if (!isAllowed(comment.user.id, comment.user.login, cfg)) {
              markProcessed(comment.id);
              continue;
            }

            const ctx = new GitHubContext({
              octokit,
              owner: repo.owner.login,
              repo: repo.name,
              issueNumber: comment.pull_request_review_id ? comment.pull_request_url.split('/').pop() : null,
              commentId: comment.id,
              userId: comment.user.id,
              userName: comment.user.login,
            });

            try {
              await handleCommand(ctx, cmd.command, cmd.arg);
              processedThisRun.push(comment.id);
            } catch (err) {
              log.error('command failed', { err: err.message, owner: repo.owner.login, repo: repo.name });
              try {
                await ctx.sendText(`❌ Error: ${err.message}`);
              } catch {}
            }

            markProcessed(comment.id);
          }
        } catch (err) {
          log.debug('repo check failed', { owner: repo.owner.login, repo: repo.name, err: err.message });
        }
      }

      page++;
    }

    if (processedThisRun.length) {
      log.info('processed comments', { count: processedThisRun.length });
    }
  } catch (err) {
    log.error('polling failed', { err: err.message });
  }
}

function startPolling(intervalMs = 45000) {
  if (isRunning) {
    log.warn('polling already running');
    return;
  }

  isRunning = true;
  log.info('polling started', { intervalMs });

  // Check immediately on start
  checkComments().catch((err) => log.error('initial check failed', { err: err.message }));

  pollingInterval = setInterval(() => {
    checkComments().catch((err) => log.error('poll check failed', { err: err.message }));
  }, intervalMs);

  pollingInterval.unref();
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  isRunning = false;
  log.info('polling stopped');
}

function isPolling() {
  return isRunning;
}

module.exports = { startPolling, stopPolling, isPolling, checkComments };

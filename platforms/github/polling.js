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
  if (!cfg.github?.token) {
    log.warn('github token not configured');
    return;
  }

  const octokit = new Octokit({ auth: cfg.github.token });

  try {
    const processedThisRun = [];
    const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get list of repos to check (from allowedRepos config, already parsed as array by config.js)
    const allowedRepos = cfg.github?.allowedRepos || [];

    if (!allowedRepos.length) {
      log.warn('no allowed repos configured - add allowedRepos to github config in data/settings.json');
      return;
    }

    log.info('polling repos', { count: allowedRepos.length, repos: allowedRepos.slice(0, 3) });

    // Check each allowed repo for /claude, /cursor, or /codex mentions
    for (const repoFullName of allowedRepos) {
      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        log.warn('invalid repo name', { repoFullName });
        continue;
      }

      try {
        const query = `repo:${owner}/${repo} (/claude OR /cursor OR /codex) in:comments updated:>=${lastDay}`;
        log.debug('searching repo', { owner, repo });

        const { data: searchResults } = await octokit.rest.search.issuesAndPullRequests({
          q: query,
          sort: 'updated',
          order: 'desc',
          per_page: 10,
        }).catch((err) => {
          if (err.status === 403) {
            log.warn('search rate limited', { repo: repoFullName });
          } else if (err.status !== 422) {
            log.error('search failed', { repo: repoFullName, status: err.status });
          }
          return { data: { items: [] } };
        });

        log.info('search results', { repo: repoFullName, count: searchResults.items?.length || 0 });

        for (const issue of searchResults.items || []) {
          try {
            const issueNum = issue.number;

            log.info('checking issue', { owner, repo, issueNum, title: issue.title.substring(0, 50) });

            // GitHub API treats PRs as issues for comments - use issues.listComments for both
            const { data: comments } = await octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: issueNum,
              sort: 'updated',
              direction: 'desc',
              per_page: 20,
            }).catch((err) => {
              log.error('failed to list comments', { owner, repo, issueNum, err: err.message });
              return { data: [] };
            });

            log.info('found comments', { owner, repo, issueNum, count: comments.length });

            for (const comment of comments) {
              log.debug('checking comment', { id: comment.id, body: comment.body.substring(0, 50), user: comment.user.login });

              if (isProcessed(comment.id)) {
                log.debug('comment already processed', { id: comment.id });
                continue;
              }

              const cmd = parseCommand(comment.body);
              log.debug('parse result', { body: comment.body.substring(0, 50), cmd });

              if (!cmd || !['claude', 'cursor', 'codex'].includes(cmd.command)) {
                log.debug('not a command or wrong command', { cmd });
                continue;
              }

              if (!isAllowed(comment.user.id, comment.user.login, cfg)) {
                log.warn('user not allowed', { userId: comment.user.id, userName: comment.user.login });
                markProcessed(comment.id);
                continue;
              }

              log.info('executing command', { command: cmd.command, arg: cmd.arg.substring(0, 50), owner, repo, issueNum });

              const ctx = new GitHubContext({
                octokit,
                owner,
                repo,
                issueNumber: issueNum,
                commentId: comment.id,
                userId: comment.user.id,
                userName: comment.user.login,
              });

              try {
                await handleCommand(ctx, cmd.command, cmd.arg);
                processedThisRun.push(comment.id);
                log.info('✅ command executed', { command: cmd.command, owner, repo, issueNum });
              } catch (err) {
                log.error('command failed', { err: err.message, owner, repo });
                try {
                  await ctx.sendText(`❌ Error: ${err.message}`);
                } catch {}
              }

              markProcessed(comment.id);
            }
          } catch (err) {
            log.error('issue processing failed', { issue: issue.number, err: err.message });
          }
        }
      } catch (err) {
        log.error('repo check failed', { repo: repoFullName, err: err.message });
      }
    }

    if (processedThisRun.length) {
      log.info('processed comments', { count: processedThisRun.length });
    }
  } catch (err) {
    log.error('polling failed', { err: err.message });
  }
}

function startPolling(intervalMs = 120000) {
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

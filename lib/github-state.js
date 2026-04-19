// Simple in-memory cache for processed GitHub comments
// Prevents duplicate responses to the same comment

let processedComments = new Set();

function markProcessed(commentId) {
  processedComments.add(commentId);
}

function isProcessed(commentId) {
  return processedComments.has(commentId);
}

function reset() {
  processedComments.clear();
}

module.exports = { markProcessed, isProcessed, reset };

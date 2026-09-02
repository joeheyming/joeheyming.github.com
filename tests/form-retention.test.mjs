import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LIVE_POSTS,
  MAX_RESPONSE_ROWS,
  attachmentChunkCount,
  pickArchiveTargets
} from '../posts/retention.js';
import { oldestCountToDrop, pruneIdleRates, RATE_IDLE_MS } from '../live-chat/retention.js';
import {
  ANSWERS_KEEP_ROUNDS,
  keepRoundIdSet,
  shouldKeepAnswerOrTallyRow,
  shouldKeepQuarantineRow
} from '../trivia/retention.js';

describe('posts retention', () => {
  it('archives oldest posts once live count exceeds the cap', () => {
    const posts = [
      { id: 'a', ts: 1, rows: 1 },
      { id: 'b', ts: 2, rows: 1 },
      { id: 'c', ts: 3, rows: 1 }
    ];
    const { archivePostIds } = pickArchiveTargets({
      posts,
      maxLivePosts: 2,
      maxRows: 100
    });
    assert.deepEqual(archivePostIds, ['a']);
  });

  it('archives oldest posts to fit the row budget, keeping the newest', () => {
    const posts = [
      { id: 'old', ts: 1, rows: 20 },
      { id: 'mid', ts: 2, rows: 20 },
      { id: 'new', ts: 3, rows: 20 }
    ];
    const { archivePostIds } = pickArchiveTargets({
      posts,
      maxLivePosts: 150,
      maxRows: 25
    });
    assert.deepEqual(archivePostIds.sort(), ['mid', 'old']);
  });

  it('does not archive the last remaining post even when it exceeds the row cap', () => {
    const { archivePostIds, dropIncompleteIds } = pickArchiveTargets({
      posts: [{ id: 'huge', ts: 1, rows: 600 }],
      maxLivePosts: 150,
      maxRows: 500
    });
    assert.deepEqual(archivePostIds, []);
    assert.deepEqual(dropIncompleteIds, []);
  });

  it('drops stale incomplete chunk groups only after posts cannot shrink further', () => {
    const { archivePostIds, dropIncompleteIds } = pickArchiveTargets({
      posts: [{ id: 'keep', ts: 9, rows: 490 }],
      incomplete: [
        { id: 'fresh', ts: 10, rows: 20, ageMs: 1000 },
        { id: 'stale', ts: 1, rows: 20, ageMs: 20 * 60 * 1000 }
      ],
      maxLivePosts: 150,
      maxRows: 500,
      incompleteMinAgeMs: 15 * 60 * 1000
    });
    assert.deepEqual(archivePostIds, []);
    assert.deepEqual(dropIncompleteIds, ['stale']);
  });

  it('counts data-URL attachments as one or more form chunks', () => {
    assert.equal(attachmentChunkCount('https://example.com/x.png', 10000), 1);
    assert.equal(attachmentChunkCount('data:image/png;base64,xx', 10000), 1);
    assert.equal(attachmentChunkCount(`data:image/png;base64,${'x'.repeat(25000)}`, 10000), 3);
  });

  it('keeps default caps in the recommended range', () => {
    assert.equal(MAX_LIVE_POSTS, 150);
    assert.equal(MAX_RESPONSE_ROWS, 500);
  });
});

describe('live chat retention', () => {
  it('drops rate-limit rows idle longer than two weeks', () => {
    const now = RATE_IDLE_MS + 50;
    const kept = pruneIdleRates(
      {
        old: { lastMsgAt: 0, lastNickAt: 0, windowStart: 0 },
        fresh: { lastMsgAt: now - 1000, lastNickAt: 0, windowStart: 0 }
      },
      now
    );
    assert.deepEqual(Object.keys(kept), ['fresh']);
  });

  it('counts oldest quarantine rows to drop', () => {
    assert.equal(oldestCountToDrop(500, 500), 0);
    assert.equal(oldestCountToDrop(720, 500), 220);
  });
});

describe('trivia retention', () => {
  it('keeps the current round plus the newest history window', () => {
    const history = Array.from({ length: 80 }, (_, i) => `r-${i}`);
    const keep = keepRoundIdSet('r-now', history, ANSWERS_KEEP_ROUNDS);
    assert.equal(keep.has('r-now'), true);
    assert.equal(keep.has('r-8'), true);
    assert.equal(keep.has('r-7'), false);
    assert.equal(keep.size, ANSWERS_KEEP_ROUNDS + 1);
  });

  it('keeps quarantines with no round id so a later row cap can trim them', () => {
    const keep = new Set(['r-1']);
    assert.equal(shouldKeepAnswerOrTallyRow('r-1', keep), true);
    assert.equal(shouldKeepAnswerOrTallyRow('r-old', keep), false);
    assert.equal(shouldKeepQuarantineRow('', keep), true);
    assert.equal(shouldKeepQuarantineRow('r-old', keep), false);
  });
});

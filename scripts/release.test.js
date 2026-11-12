import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import config from '../release.config.mjs';

const context = {
  logger: { log() {} },
  options: { repositoryUrl: config.repositoryUrl },
  branch: { name: 'master' },
  lastRelease: { version: '1.2.9', gitTag: 'v1.2.9' },
  nextRelease: { version: '2.0.0', gitTag: 'v2.0.0' },
};

describe('release tooling', () => {
  for (const [message, release] of [
    ['fix: recover after failed writes', 'patch'],
    ['feat: support native ESM', 'minor'],
    ['feat!: require supported Node versions\n\nBREAKING CHANGE: Node 10 is no longer supported.', 'major'],
    ['chore: update tooling', null],
  ]) {
    it(`classifies ${message.split('\n')[0]} as ${release}`, async () => {
      assert.equal(await analyzeCommits({ preset: config.preset }, {
        ...context, commits: [{ message }],
      }), release);
    });
  }

  it('generates nonempty release notes with changes and migration details', async () => {
    const notes = await generateNotes({ preset: config.preset }, {
      ...context,
      commits: [
        { hash: 'a'.repeat(40), message: 'fix: recover after failed writes' },
        { hash: 'b'.repeat(40), message: 'feat!: support native ESM\n\nBREAKING CHANGE: Node 10 is no longer supported.' },
      ],
    });
    assert.match(notes, /recover after failed writes/);
    assert.match(notes, /support native ESM/);
    assert.match(notes, /Node 10 is no longer supported/);
  });
});

/** @type {import('semantic-release').GlobalConfig} */
export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/gadicc/node-hosts-so-easy',
  // Keep conventional-changelog-conventionalcommits on v9 until the notes
  // generator supports v10's writer interface; release.test.js checks notes.
  // https://github.com/semantic-release/release-notes-generator/issues/992
  preset: 'conventionalcommits',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
    '@semantic-release/github',
  ],
};

#!/usr/bin/env node
'use strict';
// Records in bundle.json which official commits the two programs are built on, after a fork merged an official update.
// Usage: node scripts/update-bundle-bases.js [--desktop-repo PATH] [--browser-repo PATH] [--remote upstream]
// Both forks need the official remote fetched; each base is the official main their personal branch contains.
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const repo = resolve(__dirname, '..');
const desktopRepo = resolve(option('--desktop-repo', join(repo, '..', 'agent-desktop')));
const browserRepo = resolve(option('--browser-repo', join(repo, '..', 'agent-browser')));
const remote = option('--remote', 'upstream');

function base(fork) {
  const git = (...words) => execFileSync('git', ['-C', fork, ...words], { encoding: 'utf8' }).trim();
  const ref = remote + '/main';
  try { git('merge-base', '--is-ancestor', ref, 'personal'); } catch {
    throw new Error(fork + ': personal does not contain ' + ref + '; merge the official update first.');
  }
  const tag = git('describe', '--tags', '--abbrev=0', ref);
  return { tag, commits_after_tag: Number(git('rev-list', '--count', tag + '..' + ref)), commit: git('rev-parse', ref) };
}

const file = join(repo, 'bundle.json');
const bundle = JSON.parse(readFileSync(file, 'utf8'));
for (const [name, fork] of [['agent-desktop', desktopRepo], ['agent-browser', browserRepo]]) {
  bundle.upstream[name] = { repository: bundle.upstream[name].repository, ...base(fork) };
}
writeFileSync(file, JSON.stringify(bundle, null, 2) + '\n');
console.log(JSON.stringify(bundle.upstream, null, 2));

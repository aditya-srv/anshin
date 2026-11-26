#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function normalize(arg) {
  if (arg.startsWith('v')) {
    return { branch: arg, extVersion: arg.slice(1) };
  }
  return { branch: `v${arg}`, extVersion: arg };
}

function latestBranch() {
  const out = run('git', ['branch', '-a', '--format=%(refname:short)']);
  const versions = out
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^origin\//, ''))
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name));
  const unique = [...new Set(versions)];
  unique.sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number);
    const pb = b.slice(1).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) {
        return pa[i] - pb[i];
      }
    }
    return 0;
  });
  return unique[unique.length - 1] || '';
}

function installVsix(vsixPath) {
  const candidates = ['cursor', 'code'];
  for (const bin of candidates) {
    const result = spawnSync(bin, ['--install-extension', vsixPath], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
    });
    if (result.status === 0) {
      return bin;
    }
  }
  throw new Error(
    `Could not install ${vsixPath}. Is the cursor (or code) CLI on PATH?`
  );
}

let versionArg = process.argv[2] || '';

console.log('→ git fetch');
run('git', ['fetch', '--prune', '--quiet'], { stdio: 'inherit' });

if (!versionArg) {
  versionArg = latestBranch();
  if (!versionArg) {
    console.error('Error: no version branches found (expected e.g. v0.0.10)');
    process.exit(1);
  }
  console.log(`→ latest branch: ${versionArg}`);
}

const { branch, extVersion } = normalize(versionArg);
const vsix = `anshin-${extVersion}.vsix`;
const vsixPath = path.join(root, vsix);

console.log(`→ git checkout ${branch}`);
run('git', ['checkout', branch], { stdio: 'inherit' });

console.log('→ git pull');
run('git', ['pull'], { stdio: 'inherit' });

if (!fs.existsSync(vsixPath)) {
  console.error(`Error: ${vsix} not found after checkout of ${branch}`);
  process.exit(1);
}

console.log(`→ installing ${vsix} into Cursor`);
const used = installVsix(vsixPath);
console.log(`Done: checked out ${branch} and installed ${vsix} via ${used}`);

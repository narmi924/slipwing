'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runScript } = require('../lib/script-run');

/** A stand-in for agent-browser that answers by command name and records every call. */
function fakeBrowser(answers) {
  const calls = [];
  const call = async (binary, args, options = {}) => {
    const words = args.slice(args.indexOf('--json') + 1);
    calls.push({ words, input: options.input });
    const key = words[0] === 'tab' ? 'tab ' + words[1] : words[0];
    const answer = answers[key];
    if (answer === undefined) throw new Error('unexpected command: ' + words.join(' '));
    return typeof answer === 'function' ? answer(words, options) : answer;
  };
  const run = (source, extra) => runScript(source, { browser: 'browser', native: 'desktop', flags: ['--auto-connect'], call, allowInput: true, allowFinal: true, ...extra });
  return { calls, run };
}

const OPEN = { url: 'https://example.com/chat', title: 'Chat' };
const words = calls => calls.map(c => c.words.join(' '));

test('a run in the user Chrome keeps its tab running while it lasts and puts it back afterwards', async () => {
  const tools = fakeBrowser({ open: OPEN, 'tab keep': w => ({ keep: w[2], tabId: 't7' }) });
  await tools.run('await web.open("https://example.com/chat"); return 1;', { liveTab: true });
  assert.deepEqual(words(tools.calls), ['open https://example.com/chat', 'tab keep live', 'tab keep throttled t7']);
});

test('the tab is put back also when the script fails', async () => {
  const tools = fakeBrowser({ open: OPEN, 'tab keep': w => ({ keep: w[2], tabId: 't3' }) });
  await assert.rejects(tools.run('await web.open("https://example.com/chat"); throw new Error("boom");', { liveTab: true }));
  assert.equal(words(tools.calls).at(-1), 'tab keep throttled t3');
});

test('the background and own browsers leave the tab alone', async () => {
  const tools = fakeBrowser({ open: OPEN });
  await tools.run('await web.open("https://example.com/chat"); return 1;');
  assert.deepEqual(words(tools.calls), ['open https://example.com/chat']);
});

test('a tab claimed in the user Chrome is kept running too', async () => {
  const tools = fakeBrowser({ 'tab claim': { tabId: 't2' }, 'tab keep': w => ({ keep: w[2], tabId: 't2' }) });
  await tools.run('await web.cmd("tab", "claim", "--url", "example.com"); return 1;', { liveTab: true });
  assert.deepEqual(words(tools.calls), ['tab claim --url example.com', 'tab keep live', 'tab keep throttled t2']);
});

test('a field the page replaced on the first input gets the text again in the new field', async () => {
  const tools = fakeBrowser({
    fill: w => (w[1] === 'textarea' ? { receipt: { effects: { target_removed: true } } } : { receipt: { verified: true } }),
    eval: (w, options) => ({ result: /markReplacedField/.test(options.input) ? true : null }),
  });
  const reply = await tools.run('await web.fill("css:textarea", "你好"); return 1;');
  const fills = tools.calls.filter(c => c.words[0] === 'fill').map(c => c.words);
  assert.equal(fills.length, 2);
  assert.match(fills[1][1], /^\[data-slipwing-again="[a-z0-9]+"\]$/);
  assert.equal(fills[1][2], '你好');
  assert.match(reply.steps[0], /written into the new one/);
  assert.equal(reply.warnings, undefined);
});

test('a typed field the page replaced is cleared and typed again', async () => {
  const tools = fakeBrowser({
    type: w => (w[1] === 'textarea' ? { receipt: { effects: { target_removed: true } } } : { receipt: { verified: true } }),
    fill: { receipt: { verified: true } },
    eval: { result: true },
  });
  await tools.run('await web.type("css:textarea", "abc"); return 1;');
  const sent = words(tools.calls).filter(w => !w.startsWith('eval'));
  assert.equal(sent.length, 3);
  assert.match(sent[1], /^fill \[data-slipwing-again="[a-z0-9]+"\] $/);
  assert.match(sent[2], /^type \[data-slipwing-again="[a-z0-9]+"\] abc$/);
});

test('when no single new field can be told, the step warns instead of guessing', async () => {
  const tools = fakeBrowser({
    fill: { receipt: { effects: { target_removed: true } } },
    eval: { result: false },
  });
  const reply = await tools.run('await web.fill("css:textarea", "x"); return 1;');
  assert.equal(tools.calls.filter(c => c.words[0] === 'fill').length, 1);
  assert.match(reply.warnings.join(' '), /replaced the field/);
});

/** A stand-in for agent-desktop that answers by command name and records every call. */
function fakeDesktop(answers) {
  const calls = [];
  const call = async (binary, args) => {
    calls.push(args);
    const answer = answers[args[0]];
    if (answer === undefined) throw new Error('unexpected command: ' + args.join(' '));
    return typeof answer === 'function' ? answer(args) : answer;
  };
  const run = source => runScript(source, { browser: 'browser', native: 'desktop', flags: ['--session', 't'], call, allowInput: false, allowFinal: false });
  return { calls, run };
}

test('desktop.drop hands absolute files and the control ref to drop-files, without the real mouse', async () => {
  const tools = fakeDesktop({ 'drop-files': { details: { effect: 'copy' }, disposition: { delivery: 'delivered_unverified' } } });
  const reply = await tools.run('return await desktop.drop("w-1", ["clip.mp4"], "@s1:e2");');
  const sent = tools.calls[0];
  assert.equal(sent[0], 'drop-files');
  assert.ok(require('node:path').isAbsolute(sent[1]));
  assert.deepEqual(sent.slice(2), ['--ref', '@s1:e2']);
  assert.deepEqual(reply.result, { files: 1, effect: 'copy' });
});

test('desktop.drop refuses an empty file list before anything is sent', async () => {
  const tools = fakeDesktop({});
  await assert.rejects(tools.run('return await desktop.drop("w-1", [], "@s1:e2");'), err => err.code === 'INVALID_ARGS');
  assert.equal(tools.calls.length, 0);
});

test('a step whose app took the front and was put back says so', async () => {
  const tools = fakeDesktop({ 'drop-files': { details: { effect: 'copy', foreground: { outcome: 'restored', away_ms: 640 } } } });
  const reply = await tools.run('return await desktop.drop("w-1", "a.txt", "@s1:e2");');
  assert.match(reply.steps[0], /came to the front for 640 ms/);
});

// Checks self-improving memory in the Host Process: a role extracts durable
// facts from an exchange, skips what it already knows, writes them into its own
// memory tree, and honours the user's setting. Deterministic, no network.
// Run: npx tsx scripts/self-improve-check.mjs

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-learn-'));
const configPath = path.join(root, 'runner.json');
process.env.VUA_DATA_DIR = root;
process.env.CONFIG_PATH = configPath;
writeFileSync(configPath, JSON.stringify({ agentName: 'default' }));

const agentDir = path.join(root, 'agents', 'default');
mkdirSync(agentDir, { recursive: true });
const learnedFile = path.join(agentDir, 'memory', 'memories', 'learned.md');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const {
  parseNotes,
  readMemory,
  appendMemory,
  reflectAndLearn,
  learnFromExchange,
  selfImproveEnabled,
} = await import('../src/memory/self-improve.ts');

// --- parsing a model reply ---------------------------------------------------
check('an array is pulled out of surrounding prose', parseNotes('Sure!\n["a","b"]\nDone').length === 2);
check('non-strings are dropped', parseNotes('[1,"ok",null]').join() === 'ok');
check('a reply with no array yields nothing', parseNotes('nothing to save').length === 0);

// --- the model call ----------------------------------------------------------
let seenPrompt = '';
let seenTools = 'unset';
let nextReply = '[]';
const stubProvider = {
  name: 'stub',
  query: ({ prompt, tools }) => {
    seenPrompt = prompt;
    seenTools = tools;
    return {
      events: (async function* () {
        yield { type: 'result', text: nextReply };
      })(),
    };
  },
  isSessionInvalid: () => false,
};
const config = { provider: stubProvider, providerName: 'stub', agentId: 'default', agentDir, systemContext: { instructions: '' }, tools: (await (await import('../src/kernel/compose.ts')).composeRunner()).root.tools };

nextReply = '["Prefers Vietnamese", "Runs a coffee shop"]';
let notes = await reflectAndLearn(config, { user: 'chào em', assistant: 'chào anh' }, []);
check('durable facts are extracted', notes.length === 2);
check('reflection sees both sides of the exchange', seenPrompt.includes('chào em') && seenPrompt.includes('chào anh'));
check('reflection runs without tools', seenTools === undefined);

notes = await reflectAndLearn(config, { user: 'chào em', assistant: 'chào anh' }, ['prefers vietnamese']);
check('a fact already known is not learned twice', notes.length === 1 && notes[0] === 'Runs a coffee shop');

nextReply = '["a","b","c","d","e"]';
notes = await reflectAndLearn(config, { user: 'hello there', assistant: 'hi' }, []);
check('no more than three notes per turn', notes.length === 3);

nextReply = '["ignored"]';
check('a trivial exchange is skipped', (await reflectAndLearn(config, { user: 'ok', assistant: 'hi' }, [])).length === 0);
check('an unanswered turn is skipped', (await reflectAndLearn(config, { user: 'a real question', assistant: '' }, [])).length === 0);

// --- persistence -------------------------------------------------------------
appendMemory(agentDir, ['Prefers Vietnamese']);
check('the note lands in the role\'s own memory tree', existsSync(learnedFile));
check('the file explains itself', readFileSync(learnedFile, 'utf8').startsWith('# Learned about the user'));
appendMemory(agentDir, ['Runs a coffee shop']);
check('notes accumulate', readMemory(agentDir).length === 2);
check('the header is written only once', readFileSync(learnedFile, 'utf8').split('# Learned').length === 2);

// --- end to end, and the user's setting --------------------------------------
nextReply = '["Works in Ho Chi Minh City", "Prefers Vietnamese"]';
notes = await learnFromExchange(config, agentDir, { user: 'anh ở Sài Gòn', assistant: 'vâng ạ' });
check('a full turn learns only what is new', notes.length === 1 && notes[0] === 'Works in Ho Chi Minh City');
check('what it learned is remembered', readMemory(agentDir).includes('Works in Ho Chi Minh City'));

const failing = { ...config, provider: { ...stubProvider, query: () => { throw new Error('model down'); } } };
check('a failed reflection never breaks the turn', (await learnFromExchange(failing, agentDir, { user: 'a question', assistant: 'an answer' })).length === 0);

check('the setting defaults to on', selfImproveEnabled());
writeFileSync(configPath, JSON.stringify({ agentName: 'default', selfImprove: false }));
check('turning the setting off is picked up without a restart', !selfImproveEnabled());
const before = readMemory(agentDir).length;
nextReply = '["should not be saved"]';
await learnFromExchange(config, agentDir, { user: 'another question', assistant: 'another answer' });
check('nothing is learned while the setting is off', readMemory(agentDir).length === before);

console.log(pass ? '\n✓ self-improving memory works' : '\n✗ FAILED');
process.exit(pass ? 0 : 1);

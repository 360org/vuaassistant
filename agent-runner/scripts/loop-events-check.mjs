/**
 * Kiểm các mốc `turn/*` và `step/*` mà vòng lặp công bố.
 *
 * Điều cần chứng minh không phải "có phát sự kiện", mà là **một plugin quan sát
 * được trọn một lượt mà không đụng một dòng nào của `poll-loop.ts`**. Đó mới là
 * thứ làm cho vòng lặp thôi phình ra mỗi khi có mối quan tâm mới.
 *
 * Chỗ dễ sai nhất: lối ra bị phanh cắt ngang. Một lượt mở mà không đóng thì mọi
 * thứ đếm theo lượt — ngân sách token, thống kê — đều lệch âm thầm. Nên ở đây
 * đo cả lối ra bình thường lẫn lối ra bị cắt.
 */
import { mkdirSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-loopev-'));
mkdirSync(path.join(root, 'workspace'));
const ipc = path.join(root, 'ipc');
mkdirSync(ipc);
process.env.VUA_DATA_DIR = root;
process.env.VUA_IPC_DIR = ipc;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');

const { composeRunner } = await import('../src/kernel/compose.ts');
const { executeAgentLoop } = await import('../src/poll-loop.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

/** Provider giả: trả lời thẳng, không gọi tool. */
function plainProvider(reply = 'xong rồi Sếp') {
  return {
    name: 'stub',
    query() {
      return {
        push() {}, end() {}, abort() {},
        events: (async function* () {
          yield { type: 'init', continuation: 'c1' };
          yield { type: 'result', text: reply };
        })(),
      };
    },
    isSessionInvalid: () => false,
  };
}

/** Provider giả: gọi mãi một tool hỏng, để phanh chống lặp phải cắt ngang. */
function loopingProvider() {
  return {
    name: 'stub-loop',
    query() {
      return {
        push() {}, end() {}, abort() {},
        events: (async function* () {
          yield { type: 'init', continuation: 'c1' };
          yield {
            type: 'tool_call',
            toolCall: { id: 'x', name: 'file_read', arguments: { path: 'khong-co-that.txt' } },
          };
          yield { type: 'result', text: null };
        })(),
      };
    },
    isSessionInvalid: () => false,
  };
}

/** Plugin quan sát — KHÔNG đụng gì tới poll-loop.ts. */
function makeObserver(seen) {
  return {
    name: 'quan-sat',
    setup(ctx) {
      ctx.effect(ctx.on('turn/start', (p) => seen.push(['turn/start', p])));
      ctx.effect(ctx.on('turn/end', (p) => seen.push(['turn/end', p])));
      ctx.effect(ctx.on('step/start', (p) => seen.push(['step/start', p])));
      ctx.effect(ctx.on('step/end', (p) => seen.push(['step/end', p])));
      ctx.effect(ctx.on('tool/result', (p) => seen.push(['tool/result', p])));
    },
  };
}

// --- 1. Lượt bình thường ----------------------------------------------------
{
  const seen = [];
  const kernel = await composeRunner();
  await kernel.use(makeObserver(seen));
  const config = {
    provider: plainProvider(), providerName: 'stub', agentId: 'default',
    systemContext: { instructions: '' }, tools: kernel.root.tools, ctx: kernel.root,
  };
  await executeAgentLoop(config, 'chào em', undefined, {}, config.systemContext);
  const names = seen.map(([n]) => n);
  check('plugin ngoài quan sát được cả lượt mà không sửa poll-loop',
    names.includes('turn/start') && names.includes('turn/end'));
  check('mốc đúng thứ tự: mở lượt → mở bước → đóng bước → đóng lượt',
    names.join('>').startsWith('turn/start>step/start') && names.at(-1) === 'turn/end');
  const end = seen.find(([n]) => n === 'turn/end')[1];
  check('lượt trả lời thẳng ⇒ ghi nhãn completed', end.outcome === 'completed');
  check('đếm đúng số bước', end.steps === 1);
  await kernel.dispose();
}

// --- 2. Lượt bị phanh cắt ngang ---------------------------------------------
{
  const seen = [];
  const kernel = await composeRunner();
  await kernel.use(makeObserver(seen));
  const config = {
    provider: loopingProvider(), providerName: 'stub', agentId: 'default',
    systemContext: { instructions: '' }, tools: kernel.root.tools, ctx: kernel.root,
  };
  await executeAgentLoop(config, 'đọc tệp đi', undefined, {}, config.systemContext);
  const ends = seen.filter(([n]) => n === 'turn/end');
  check('lượt bị phanh cắt ngang VẪN đóng đúng một lần', ends.length === 1);
  check('lối ra bị cắt được ghi nhãn loop-guard, không phải completed',
    ends[0][1].outcome === 'loop-guard');
  check('tool đã chạy đều được công bố', seen.some(([n]) => n === 'tool/result'));
  await kernel.dispose();
}

// --- 3. Không có ctx thì vòng lặp vẫn chạy ----------------------------------
// Sự kiện là điểm mở rộng, không phải phụ thuộc bắt buộc.
{
  const kernel = await composeRunner();
  const config = {
    provider: plainProvider('ổn'), providerName: 'stub', agentId: 'default',
    systemContext: { instructions: '' }, tools: kernel.root.tools,
  };
  const result = await executeAgentLoop(config, 'chào', undefined, {}, config.systemContext);
  check('bỏ trống ctx thì vòng lặp vẫn chạy bình thường', result.text === 'ổn');
  await kernel.dispose();
}

console.log(
  pass
    ? '\n✓ mốc vòng lặp: quan sát được trọn lượt từ ngoài, lượt luôn đóng kể cả khi bị cắt'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);

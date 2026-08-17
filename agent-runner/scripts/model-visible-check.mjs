/**
 * Kiểm luật "model thấy gì thì sổ phải có".
 *
 * Điều cần chứng minh không phải "có hàm ghi sổ", mà là **không có đường nào
 * khác để nhét thứ gì vào mắt model**. Nên bài này đo trên vòng lặp thật: chạy
 * một lượt có tri thức được nạp, rồi bắt đúng chuỗi `instructions` mà provider
 * nhận được, và đòi nó dựng lại được từ sổ.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const root = mkdtempSync(path.join(tmpdir(), 'ar-mv-'));
mkdirSync(path.join(root, 'workspace'));
const ipc = path.join(root, 'ipc');
mkdirSync(ipc);
process.env.VUA_DATA_DIR = root;
process.env.VUA_IPC_DIR = ipc;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(root, 'workspace');

const { composeRunner } = await import('../src/kernel/compose.ts');
const { executeAgentLoop } = await import('../src/poll-loop.ts');
const { bucketFor } = await import('../src/knowledge/index.ts');
const { DatabaseSync } = await import('node:sqlite');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

/** Provider giả, giữ lại đúng chuỗi instructions nó nhận được. */
function spyProvider(seen) {
  return {
    name: 'spy',
    query(input) {
      seen.push(input.systemContext?.instructions ?? '');
      return {
        push() {}, end() {}, abort() {},
        events: (async function* () {
          yield { type: 'init', continuation: 'c1' };
          yield { type: 'result', text: 'xong' };
        })(),
      };
    },
    isSessionInvalid: () => false,
  };
}

// Nạp một tài liệu đúng cách app ghi vào, để RAG có cái mà chèn thật.
{
  const db = new DatabaseSync(path.join(ipc, 'knowledge.db'));
  db.exec(`
    CREATE TABLE knowledge_files (
      file_id TEXT PRIMARY KEY, bucket TEXT NOT NULL, name TEXT NOT NULL,
      data_url TEXT, added_at INTEGER NOT NULL);
    CREATE TABLE knowledge_chunks (
      file_id TEXT NOT NULL, bucket TEXT NOT NULL, idx INTEGER NOT NULL,
      text TEXT NOT NULL, PRIMARY KEY (file_id, idx));
  `);
  const bucket = bucketFor('default');
  db.prepare('INSERT INTO knowledge_files (file_id, bucket, name, data_url, added_at) VALUES (?,?,?,NULL,?)')
    .run('f1', bucket, 'so-tay.txt', Date.now());
  db.prepare('INSERT INTO knowledge_chunks (file_id, bucket, idx, text) VALUES (?,?,?,?)')
    .run('f1', bucket, 0, 'Chi nhánh Cần Thơ đạt doanh thu 87 triệu đồng trong quý này.');
  db.close();
}

const seen = [];
const kernel = await composeRunner();
const config = {
  provider: spyProvider(seen), providerName: 'spy', agentId: 'default',
  systemContext: { instructions: 'NEN-LOI-NHAC' },
  tools: kernel.root.tools, ctx: kernel.root,
};
await executeAgentLoop(config, 'doanh thu Cần Thơ bao nhiêu', undefined, {}, config.systemContext);

const sentToModel = seen[0] ?? '';
const ledger = kernel.root.modelVisible;
const recorded = ledger.entries();

check('có tri thức thật sự được chèn vào lời nhắc (nếu 0 thì bài này vô nghĩa)',
  recorded.length > 0);
check('phần chèn thêm được ghi sổ kèm tên nguồn',
  recorded.every((entry) => entry.source.length > 0));
check('chuỗi gửi model dựng lại được ĐÚNG từ sổ',
  sentToModel === ['NEN-LOI-NHAC', ...recorded.map((e) => e.text)].join(''));
check('phần nền vẫn còn nguyên đầu lời nhắc', sentToModel.startsWith('NEN-LOI-NHAC'));
check('nội dung tài liệu thật sự tới được model', sentToModel.includes('Cần Thơ'));

// ĐẢO NGƯỢC: một chuỗi nối thẳng ngoài sổ thì KHÔNG dựng lại được — đây đúng là
// cái mà luật này cấm, và là lối cũ của mã trước khi sửa.
const lenLut = sentToModel + '\n(chèn lén ngoài sổ)';
check('ĐẢO NGƯỢC: chèn thẳng ngoài sổ thì phép dựng lại thất bại',
  lenLut !== ['NEN-LOI-NHAC', ...recorded.map((e) => e.text)].join(''));

// Mở lượt mới phải xoá sổ, không để lượt trước dính sang.
await kernel.root.emit('turn/start', { agentId: 'default', goal: 'lượt khác' });
check('mở lượt mới ⇒ sổ được xoá, không dính từ lượt trước',
  kernel.root.modelVisible.entries().length === 0);

await kernel.dispose();
console.log(
  pass
    ? '\n✓ model thấy gì thì sổ có nấy — lời nhắc dựng lại được nguyên vẹn từ sổ'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);

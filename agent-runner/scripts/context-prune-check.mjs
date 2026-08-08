#!/usr/bin/env node
/**
 * Cắt tỉa ngữ cảnh phải rẻ đi thật, mà không phá hợp đồng của nhà cung cấp.
 *
 * Lịch sử hội thoại được gửi lại NGUYÊN VẸN ở mỗi vòng lặp tool, nên nếu không
 * cắt thì chi phí tăng theo bình phương số vòng. Nhưng cắt ẩu còn tệ hơn tốn
 * tiền: bỏ một tin `tool` mà giữ `assistant` gọi nó thì Gemini từ chối cả
 * request vì function call mồ côi — agent chết hẳn thay vì chỉ đắt.
 *
 * Nên test này khoá hai thứ song song: **có rẻ đi thật không** (đo token) và
 * **cấu trúc còn hợp lệ không** (mọi tool_call đều còn đủ kết quả đi kèm).
 */
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'scripts/.context-prune-bundle.mjs');

await build({
  entryPoints: [path.join(root, 'src/context-prune.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { pruneHistory, shrink, estimateTokens, DEFAULT_PRUNE } =
  await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

/** Dựng một lượt agentic: mục tiêu, rồi N cụm assistant→tool. */
function history(rounds, { error = null, bulky = false } = {}) {
  const messages = [{ role: 'user', content: 'Lấy giúp anh báo cáo doanh thu tháng này' }];
  for (let i = 0; i < rounds; i++) {
    const id = `call_${i}`;
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [{ id, name: 'http_request', arguments: { url: 'https://api.example.com' } }],
    });
    messages.push({
      role: 'tool',
      tool_call_id: id,
      name: 'http_request',
      content: error
        ? error
        : bulky
          ? 'OK\n' + 'x'.repeat(9000)
          : `Kết quả bước ${i}`,
    });
  }
  return messages;
}

/**
 * Cấu trúc còn hợp lệ với nhà cung cấp hay không.
 *
 * Phải kiểm CẢ HAI chiều. Chỉ kiểm "assistant có đủ tool" là chưa đủ: cắt lệch
 * một tin sẽ để lại một `tool` **mồ côi** không có assistant đứng trước, và
 * chính cái đó làm Gemini từ chối nguyên request.
 */
function structureValid(messages) {
  if (messages[0]?.role !== 'user') return false;
  const answered = new Set();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.tool_calls?.length) continue;
    for (let n = 0; n < message.tool_calls.length; n++) {
      const next = messages[i + 1 + n];
      if (!next || next.role !== 'tool') return false;
      if (next.tool_call_id !== message.tool_calls[n].id) return false;
      answered.add(i + 1 + n);
    }
  }
  // Chiều ngược lại: mọi tin `tool` phải thuộc về một tool_call phía trên.
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool' && !answered.has(i)) return false;
  }
  return true;
}

// --- 1. Lượt ngắn thì đừng đụng vào -----------------------------------------
const short = history(2);
const shortPruned = pruneHistory(short);
check('lượt ngắn giữ nguyên số tin', shortPruned.length === short.length);
check(
  'lượt ngắn không bị cắt nội dung',
  shortPruned.every((m, i) => m.content === short[i].content),
);
check('lượt ngắn vẫn hợp lệ', structureValid(shortPruned));

// --- 2. Lỗi lặp lại: gộp, không dán lại nguyên văn --------------------------
const sameError = 'Error: connect ECONNREFUSED 127.0.0.1:5432\n' + 'chi tiết '.repeat(200);
const repeating = history(5, { error: sameError });
const repeatPruned = pruneHistory(repeating);
const fullCopies = repeatPruned.filter(
  (m) => m.role === 'tool' && m.content.includes('ECONNREFUSED'),
).length;
check('lỗi lặp chỉ còn giữ nguyên văn một lần', fullCopies === 1);
check(
  'những lần trước được thay bằng dòng đếm',
  repeatPruned.some((m) => m.role === 'tool' && /đã gặp \d+ lần/.test(m.content)),
);
check('gộp lỗi lặp không phá cấu trúc', structureValid(repeatPruned));

const beforeRepeat = estimateTokens(repeating);
const afterRepeat = estimateTokens(repeatPruned);
check(
  `gộp lỗi lặp rẻ đi thật (~${beforeRepeat} → ~${afterRepeat} token)`,
  afterRepeat < beforeRepeat / 2,
);

// Chỉ LỖI mới được gộp. Dấu vân tay bỏ hết chữ số, nên nếu gộp mọi kết quả
// tool thì "Kết quả bước 1" và "Kết quả bước 2" thành trùng nhau và ta xoá mất
// dữ liệu thật — model mất thông tin chứ không phải mất rác.
const distinct = [
  { role: 'user', content: 'Tổng hợp doanh thu 3 chi nhánh' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'a', name: 'q', arguments: {} }] },
  { role: 'tool', tool_call_id: 'a', name: 'q', content: 'Chi nhánh 1: 120000000 đồng' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'b', name: 'q', arguments: {} }] },
  { role: 'tool', tool_call_id: 'b', name: 'q', content: 'Chi nhánh 2: 340000000 đồng' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c', name: 'q', arguments: {} }] },
  { role: 'tool', tool_call_id: 'c', name: 'q', content: 'Chi nhánh 3: 550000000 đồng' },
];
const distinctPruned = pruneHistory(distinct);
check(
  'kết quả THÀNH CÔNG chỉ khác nhau ở con số thì KHÔNG bị gộp',
  distinctPruned.filter((m) => m.role === 'tool').every((m, i) => m.content === distinct[2 + i * 2].content),
);
check(
  'không có số liệu nào bị thay bằng dòng đếm',
  !distinctPruned.some((m) => /đã gặp \d+ lần/.test(m.content)),
);

// --- 3. Kết quả tool dài: cắt bớt, giữ cả đầu lẫn đuôi ----------------------
const bulky = history(3, { bulky: true });
const bulkyPruned = pruneHistory(bulky);
const beforeBulky = estimateTokens(bulky);
const afterBulky = estimateTokens(bulkyPruned);
check(
  `kết quả dài được cắt bớt (~${beforeBulky} → ~${afterBulky} token)`,
  afterBulky < beforeBulky / 2,
);
check('cắt xong vẫn hợp lệ', structureValid(bulkyPruned));

const trimmed = shrink('ĐẦU' + 'x'.repeat(9000) + 'ĐUÔI', DEFAULT_PRUNE);
check('giữ phần đầu khi cắt', trimmed.startsWith('ĐẦU'));
check('giữ phần đuôi khi cắt', trimmed.endsWith('ĐUÔI'));
check('nói rõ đã bỏ bao nhiêu', /bỏ bớt \d+ ký tự/.test(trimmed));

// --- 4. Stack trace: giữ vài dòng đầu ---------------------------------------
const trace =
  'TypeError: undefined is not a function\n' +
  Array.from({ length: 40 }, (_, i) => `    at frame${i} (/app/src/file.js:${i}:1)`).join('\n');
const tracePruned = shrink(trace, DEFAULT_PRUNE);
const frames = (tracePruned.match(/^\s+at frame/gm) || []).length;
check(`stack trace chỉ giữ ${DEFAULT_PRUNE.maxTraceLines} khung đầu`, frames === DEFAULT_PRUNE.maxTraceLines);
check('vẫn giữ dòng nói lỗi gì', tracePruned.includes('TypeError'));
check('nói rõ đã bỏ bao nhiêu khung', /bỏ bớt \d+ dòng ngăn xếp/.test(tracePruned));

// --- 5. Lượt rất dài: bỏ cụm cũ, nhưng KHÔNG được phá cấu trúc --------------
// Đây là chỗ dễ hỏng nhất: bỏ một tin `tool` mà giữ `assistant` gọi nó thì
// Gemini từ chối cả request. Phải bỏ trọn cụm.
const long = history(20);
const longPruned = pruneHistory(long);
check('lượt dài bị cắt bớt số tin', longPruned.length < long.length);
check('CẤU TRÚC vẫn hợp lệ sau khi bỏ cụm cũ', structureValid(longPruned));
check('mục tiêu ban đầu vẫn còn', longPruned[0].content.includes('báo cáo doanh thu'));
check(
  'các bước gần nhất còn nguyên vẹn',
  longPruned[longPruned.length - 1].content === long[long.length - 1].content,
);
check(
  'có ghi chú đã bỏ bớt, không bỏ lén',
  longPruned.some((m) => /bỏ bớt \d+ bước công cụ cũ/.test(m.content)),
);
const beforeLong = estimateTokens(long);
const afterLong = estimateTokens(longPruned);
check(`lượt dài rẻ đi thật (~${beforeLong} → ~${afterLong} token)`, afterLong < beforeLong);

// --- 6. Không sửa đầu vào ---------------------------------------------------
const original = history(12, { bulky: true });
const snapshot = JSON.stringify(original);
pruneHistory(original);
check('không sửa mảng đầu vào', JSON.stringify(original) === snapshot);

rmSync(outfile, { force: true });

console.log(
  pass
    ? '\n✓ cắt tỉa ngữ cảnh rẻ đi thật mà không phá hợp đồng nhà cung cấp'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);

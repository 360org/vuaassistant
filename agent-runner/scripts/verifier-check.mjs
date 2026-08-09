#!/usr/bin/env node
/**
 * Vai kiểm phải thật sự kiểm, không phải con dấu đóng sẵn.
 *
 * Agent làm việc có hậu quả thật — gửi email cho khách, tiêu tiền quảng cáo —
 * thì không nên tự chấm bài của chính mình. Nhưng một vai kiểm làm ẩu còn tệ
 * hơn không có: nó tốn thêm một lượt gọi model cho mỗi hành động, rồi gật đầu
 * với mọi thứ, và người dùng lại tưởng đã có ai đó canh.
 *
 * Ba chỗ hỏng thầm lặng, đều được kiểm riêng:
 *   - dùng chung phiên với vai làm ⇒ nó đọc lại lý lẽ của chính mình rồi khen;
 *   - được cầm công cụ ⇒ mở thêm một đường chạy side effect không ai canh;
 *   - lỗi/rỗng/sai định dạng mà cho qua ⇒ thành con dấu đóng sẵn.
 */
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(root, 'scripts/.verifier-bundle.mjs');

await build({
  entryPoints: [path.join(root, 'src/verifier.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { verifyAction, parseVerdict, describeAction, refusalMessage } =
  await import(pathToFileURL(outfile).href);

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const ACTION = {
  name: 'send_email',
  summary: 'Gửi email qua tài khoản đã kết nối',
  args: { to: 'khach@example.com', subject: 'Báo giá' },
  goal: 'Gửi báo giá cho khách hàng Minh',
};

/** Nhà cung cấp giả: ghi lại đúng thứ được truyền vào, trả lời theo kịch bản. */
function fakeProvider(reply, { throwOn = false } = {}) {
  const seen = [];
  return {
    seen,
    name: 'fake',
    query(input) {
      seen.push(input);
      return {
        push() {}, end() {}, abort() {},
        events: (async function* () {
          if (throwOn) { yield { type: 'error', message: 'mạng hỏng', retryable: false }; return; }
          yield { type: 'text_delta', text: reply };
        })(),
      };
    },
  };
}

// --- 1. Ba điều bắt buộc về cách gọi ---------------------------------------
const provider = fakeProvider('{"verdict":"DUYET","reason":"Đúng yêu cầu của người dùng."}');
const approved = await verifyAction(provider, ACTION);
const call = provider.seen[0];

check('duyệt được khi vai kiểm đồng ý', approved.verdict === 'DUYET');
check(
  'vai kiểm chạy trong PHIÊN RIÊNG (không nối tiếp phiên vai làm)',
  call.continuation === undefined,
);
check(
  'vai kiểm KHÔNG thấy transcript của vai làm',
  Array.isArray(call.messages) && call.messages.length === 0,
);
check('vai kiểm KHÔNG được cầm công cụ nào', call.tools === undefined);
check(
  'vai kiểm được dặn mặc định là từ chối',
  /TÌM LÝ DO TỪ CHỐI/.test(call.systemContext?.instructions ?? ''),
);
check(
  'vai kiểm thấy cả việc người dùng yêu cầu lẫn hành động sắp chạy',
  call.prompt.includes(ACTION.goal) && call.prompt.includes('send_email'),
);
check('vai kiểm thấy tham số thật', call.prompt.includes('khach@example.com'));

// --- 2. Từ chối và hỏi lại --------------------------------------------------
const rejected = await verifyAction(
  fakeProvider('{"verdict":"TU_CHOI","reason":"Người dùng chưa duyệt địa chỉ nhận."}'),
  ACTION,
);
check('từ chối được', rejected.verdict === 'TU_CHOI');
check('giữ nguyên lý do để đưa người dùng đọc', /chưa duyệt địa chỉ/.test(rejected.reason));

const asked = await verifyAction(
  fakeProvider('{"verdict":"HOI_NGUOI_DUNG","reason":"Số tiền lớn, nên hỏi lại."}'),
  ACTION,
);
check('hỏi lại người dùng được', asked.verdict === 'HOI_NGUOI_DUNG');

// --- 3. MỌI cách hỏng đều phải nghiêng về phía KHÔNG chạy -------------------
// Đây là chỗ dễ biến vai kiểm thành con dấu đóng sẵn nhất.
const hongCases = [
  ['trả lời rỗng', ''],
  ['không có JSON', 'Tôi nghĩ là được thôi, cứ chạy đi.'],
  ['JSON hỏng', '{"verdict": "DUYET", }'],
  ['thiếu trường verdict', '{"reason":"ổn mà"}'],
  ['verdict lạ', '{"verdict":"CO_LE_DUOC","reason":"?"}'],
  ['verdict rỗng', '{"verdict":"","reason":"?"}'],
  ['JSON là mảng', '[{"verdict":"DUYET"}]'],
  ['null', 'null'],
];
for (const [label, reply] of hongCases) {
  const decision = await verifyAction(fakeProvider(reply), ACTION);
  check(`${label} ⇒ KHÔNG chạy`, decision.verdict !== 'DUYET');
}
const broken = await verifyAction(fakeProvider('', { throwOn: true }), ACTION);
check('lời gọi bị lỗi ⇒ KHÔNG chạy', broken.verdict === 'TU_CHOI');
check('lỗi vẫn nói được cho người dùng hiểu', /dừng lại/.test(broken.reason));

// Chỉ đúng chữ DUYET mới là duyệt — và chấp nhận vài kiểu viết hoa/gạch.
check('chấp nhận viết thường', parseVerdict('{"verdict":"duyet","reason":"ok"}').verdict === 'DUYET');
check(
  'chấp nhận gạch nối thay gạch dưới',
  parseVerdict('{"verdict":"hoi-nguoi-dung","reason":"ok"}').verdict === 'HOI_NGUOI_DUNG',
);
check(
  'chữ gần giống nhưng khác nghĩa thì KHÔNG duyệt',
  parseVerdict('{"verdict":"KHONG_DUYET","reason":"x"}').verdict === 'TU_CHOI',
);

// --- 4. Câu báo cho người dùng ---------------------------------------------
const message = refusalMessage(ACTION, rejected);
check('câu báo nói rõ đã DỪNG, chưa chạy', /chưa chạy|dừng/.test(message));
check('câu báo nêu lý do', message.includes(rejected.reason));
check('câu báo mở đường cho người dùng duyệt tiếp', /Sếp duyệt/.test(message));
check('câu báo không đổ JSON thô', !/\{"verdict"/.test(message));

// --- 5. Mô tả hành động không bịa thêm --------------------------------------
const described = describeAction(ACTION);
check('mô tả có đủ tên, công dụng, tham số', /send_email/.test(described) && /Gửi email/.test(described));

rmSync(outfile, { force: true });

console.log(
  pass
    ? '\n✓ vai kiểm thật sự kiểm: phiên riêng, không công cụ, mọi cách hỏng đều nghiêng về không chạy'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);

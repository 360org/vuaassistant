/**
 * Kiểm lớp plugin: kernel và sổ đăng ký tool.
 *
 * Mỗi khẳng định ở đây đều đi kèm một phép ĐẢO NGƯỢC: dựng lại đúng cái hỏng
 * mà khẳng định đó phải bắt, rồi đòi nó phải đỏ. Không có phần đảo ngược thì
 * "0 lỗi" chẳng chứng minh được gì — bài test có thể đang câm, hoặc nổ giữa
 * chừng rồi im lặng đi qua. Trong chính dự án này đã có hai lần như vậy.
 */
import { createKernel } from '../src/kernel/runtime.ts';
import { toolsPlugin, UNTRUSTED_TOOL_POLICY } from '../src/kernel/tools.ts';

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

/** Chạy một hàm, trả về thông điệp lỗi nếu nó ném, hoặc null nếu chạy trót lọt. */
async function throws(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const toolStub = (name, extra = {}) => ({
  name,
  description: `tool ${name}`,
  input_schema: { type: 'object', properties: {} },
  sideEffect: false,
  requiresApproval: false,
  execute: async () => ({ tool_call_id: '', content: 'ok' }),
  ...extra,
});

// ===========================================================================
console.log('\n── 1. Đăng ký là effect: gỡ plugin là rút sạch ─────────────────');
// ===========================================================================
{
  const kernel = createKernel();
  let seen = 0;
  await kernel.use({
    name: 'nghe',
    setup(ctx) {
      ctx.effect(ctx.on('kernel/ready', () => { seen += 1; }));
    },
  });
  await kernel.start();
  const afterStart = seen;
  await kernel.dispose();
  await kernel.root.emit('kernel/ready');
  check('listener chạy khi plugin còn sống', afterStart === 1);
  check('listener im sau khi plugin bị gỡ', seen === 1);

  // ĐẢO NGƯỢC: một kernel KHÔNG gỡ listener phải làm khẳng định trên đỏ.
  const leaky = createKernel();
  let leaked = 0;
  await leaky.use({
    name: 'nghe',
    setup(ctx) {
      // Cố tình không đi qua ctx.effect — đây là cái sai mà bài test phải bắt.
      leaky.root.on('kernel/ready', () => { leaked += 1; });
    },
  });
  await leaky.start();
  await leaky.dispose();
  await leaky.root.emit('kernel/ready');
  check('ĐẢO NGƯỢC: đăng ký ngoài ctx.effect thì rò qua lần gỡ (đúng như dự đoán)', leaked === 2);
}

// ===========================================================================
console.log('\n── 2. Dịch vụ provide() phải plugin khác nhìn thấy ─────────────');
// ===========================================================================
{
  // Đây chính là lỗi đã mắc lúc viết kernel: gán `ctx.tools = …` chỉ ghi lên
  // khung nhìn riêng của plugin, plugin sau không bao giờ thấy.
  const kernel = createKernel();
  let seenFromOther;
  await kernel.use(toolsPlugin);
  await kernel.use({
    name: 'ben-thu-hai',
    dependencies: ['tools'],
    setup(ctx) { seenFromOther = ctx.tools; },
  });
  check('plugin nạp sau thấy dịch vụ plugin trước gắn', typeof seenFromOther?.register === 'function');

  // ĐẢO NGƯỢC: gán thẳng lên ctx (lối sai) thì plugin sau KHÔNG thấy.
  const broken = createKernel();
  let seenFromBroken = 'chưa chạy';
  await broken.use({
    name: 'gan-thang',
    setup(ctx) { ctx.dichVuGiaDinh = { ok: true }; },
  });
  await broken.use({
    name: 'ben-kia',
    setup(ctx) { seenFromBroken = ctx.dichVuGiaDinh; },
  });
  check('ĐẢO NGƯỢC: gán thẳng ctx.x thì plugin sau không thấy (đúng như dự đoán)', seenFromBroken === undefined);

  const duplicate = await throws(async () => {
    const k = createKernel();
    await k.use(toolsPlugin);
    await k.use({ name: 'gian-lan', setup: (ctx) => ctx.provide('tools', {}) });
  });
  check('gắn đè dịch vụ đã có thì nổ', duplicate !== null && duplicate.includes('tools'));
}

// ===========================================================================
console.log('\n── 3. Sai cấu hình nổ to, không im lặng bỏ qua ─────────────────');
// ===========================================================================
{
  const dupName = await throws(async () => {
    const k = createKernel();
    await k.use({ name: 'a', setup() {} });
    await k.use({ name: 'a', setup() {} });
  });
  check('trùng tên plugin thì nổ', dupName !== null);

  const missingDep = await throws(async () => {
    const k = createKernel();
    await k.use({ name: 'b', dependencies: ['chua-co'], setup() {} });
  });
  check('thiếu phụ thuộc thì nổ, nêu rõ tên còn thiếu',
    missingDep !== null && missingDep.includes('chua-co'));

  // Nạp hỏng giữa chừng phải rút sạch phần đã kịp cắm, không để lại nửa vời.
  const k = createKernel();
  let disposed = false;
  const failed = await throws(() => k.use({
    name: 'hong',
    setup(ctx) {
      ctx.effect(() => { disposed = true; });
      throw new Error('vỡ giữa chừng');
    },
  }));
  check('setup ném thì kernel gỡ lại phần đã cắm', failed !== null && disposed === true);
  check('plugin nạp hỏng không nằm lại trong sổ', !k.loaded.includes('hong'));
}

// ===========================================================================
console.log('\n── 4. Thác nước: next() nhường, không gọi là chặn ──────────────');
// ===========================================================================
{
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  const order = [];
  await kernel.use({
    name: 'lop-trong',
    dependencies: ['tools'],
    setup(ctx) {
      ctx.effect(ctx.intercept('tools/pre-execute', async (_p, next) => {
        order.push('trong-vao'); const r = await next(); order.push('trong-ra'); return r;
      }));
    },
  });
  await kernel.use({
    name: 'lop-ngoai',
    dependencies: ['tools'],
    setup(ctx) {
      ctx.effect(ctx.intercept('tools/pre-execute', async (_p, next) => {
        order.push('ngoai-vao'); const r = await next(); order.push('ngoai-ra'); return r;
      }));
    },
  });
  kernel.root.tools.register(toolStub('doc_file'), 'native');
  const result = await kernel.root.tools.execute('doc_file', {});
  check('đăng ký sau bọc ngoài đăng ký trước',
    order.join('>') === 'ngoai-vao>trong-vao>trong-ra>ngoai-ra');
  check('tool vẫn chạy tới đích khi mọi lớp đều gọi next()', result.content === 'ok');

  // Lớp không gọi next() phải CHẶN được tool — đây là cách chính sách từ chối.
  const blocking = createKernel();
  await blocking.use(toolsPlugin);
  let ran = false;
  await blocking.use({
    name: 'chan',
    dependencies: ['tools'],
    setup(ctx) {
      ctx.effect(ctx.intercept('tools/pre-execute', async () => ({
        tool_call_id: '', content: 'bị chặn bởi chính sách', is_error: true,
      })));
    },
  });
  blocking.root.tools.register(toolStub('gui_tien', {
    execute: async () => { ran = true; return { tool_call_id: '', content: 'đã gửi' }; },
  }), 'native');
  const blocked = await blocking.root.tools.execute('gui_tien', {});
  check('lớp không gọi next() thì chặn được tool', blocked.is_error === true && ran === false);
  check('ĐẢO NGƯỢC: tool bị chặn thật sự KHÔNG chạy', ran === false);
}

// ===========================================================================
console.log('\n── 5. Tool tự khai tính chất — hết đoán theo tên ───────────────');
// ===========================================================================
{
  // Lối cũ trong capability-rail.ts: đoán bằng regex khớp vào tên tool.
  const OLD_SIDE = /(^|__)send|write|edit|delete|create|update|post|publish|message/i;
  const OLD_APPROVAL = /(^|__)send|delete|post|publish|message/i;

  const NGUY_HIEM = ['wire_transfer', 'charge_card', 'transfer_money', 'deploy_production',
    'drop_database', 'revoke_access', 'pay_invoice', 'execute_trade'];
  const CHI_DOC = ['read_messages', 'list_messages', 'search_message_history'];

  const oldMissed = NGUY_HIEM.filter((n) => !OLD_APPROVAL.test(n));
  const oldFalseAlarm = CHI_DOC.filter((n) => OLD_SIDE.test(n));
  check(`lối cũ bỏ lọt ${oldMissed.length}/${NGUY_HIEM.length} tool nguy hiểm (bằng chứng lỗ hổng)`,
    oldMissed.length === NGUY_HIEM.length);
  check(`lối cũ báo oan ${oldFalseAlarm.length}/${CHI_DOC.length} tool chỉ đọc (bằng chứng nhiễu)`,
    oldFalseAlarm.length === CHI_DOC.length);

  // Lối mới: tool khai, registry không đoán.
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  const { tools } = kernel.root;
  for (const name of NGUY_HIEM) {
    tools.register(toolStub(name, { sideEffect: true, requiresApproval: true }), 'native');
  }
  for (const name of CHI_DOC) {
    tools.register(toolStub(name, { sideEffect: false, requiresApproval: false }), 'native');
  }
  const missedNow = NGUY_HIEM.filter((n) => !tools.get(n).requiresApproval);
  const falseAlarmNow = CHI_DOC.filter((n) => tools.get(n).sideEffect);
  check('lối mới: không bỏ lọt tool nguy hiểm nào', missedNow.length === 0);
  check('lối mới: không báo oan tool chỉ đọc nào', falseAlarmNow.length === 0);

  // Tool ngoài (MCP) không tự khai được → mặc định chặt nhất.
  tools.registerUntrusted({
    name: 'mcp__la__khong_ro',
    description: 'tool từ server lạ',
    input_schema: { type: 'object' },
    execute: async () => ({ tool_call_id: '', content: '' }),
  }, 'mcp');
  const untrusted = tools.get('mcp__la__khong_ro');
  check('tool MCP không khai thì mặc định phải hỏi',
    untrusted.requiresApproval === true && untrusted.sideEffect === true);
  check('ĐẢO NGƯỢC: mặc định cho tool ngoài là CHẶT chứ không lỏng',
    UNTRUSTED_TOOL_POLICY.requiresApproval === true && UNTRUSTED_TOOL_POLICY.sideEffect === true);
}

// ===========================================================================
console.log('\n── 6. Trường nội bộ không được lọt ra model ────────────────────');
// ===========================================================================
{
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  kernel.root.tools.register(toolStub('file_write', { sideEffect: true, requiresApproval: true }), 'native');
  const [definition] = kernel.root.tools.definitions();
  const keys = Object.keys(definition).sort();
  check('definitions() chỉ gửi name/description/input_schema',
    keys.join(',') === 'description,input_schema,name');

  // ĐẢO NGƯỢC: chính spec gốc CÓ những trường đó, nên phép so trên không vacuous.
  const spec = kernel.root.tools.get('file_write');
  const hostOnly = ['execute', 'sideEffect', 'requiresApproval', 'origin'];
  check('ĐẢO NGƯỢC: spec gốc thật sự mang các trường nội bộ đó',
    hostOnly.every((k) => k in spec) && hostOnly.every((k) => !(k in definition)));

  const dup = await throws(async () => {
    kernel.root.tools.register(toolStub('file_write'), 'mcp');
  });
  check('trùng tên tool thì nổ, không cho nguồn ngoài đè tool nội bộ',
    dup !== null && dup.includes('file_write'));
}

console.log(
  pass
    ? '\n✓ lớp plugin đạt: effect gỡ sạch, dịch vụ dùng chung, thác nước chặn được, tool tự khai tính chất'
    : '\n✗ FAILED',
);
process.exit(pass ? 0 : 1);

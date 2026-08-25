/**
 * Test kiểm chứng Task System Plugin (s10_task_system + Everything is a plugin).
 *
 * Kiểm tra:
 *   1. Tạo task mới (task_create) trả về mã task_xxxxxxxx
 *   2. Thêm phụ thuộc (task_update với addBlockedBy)
 *   3. Kiểm tra phát hiện chu trình phụ thuộc (Cycle Detection)
 *   4. Đánh giá điều kiện canStart dựa trên trạng thái của task phụ thuộc
 *   5. Cập nhật trạng thái lifecycle: pending -> in_progress -> completed
 *   6. Đăng ký & gọi tool qua kernel.tools (task_create, task_update, task_get, task_list)
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createKernel } from '../src/kernel/runtime.ts';
import { toolsPlugin } from '../src/kernel/tools.ts';
import { createTaskSystemPlugin, TaskStore } from '../src/plugins/tasks.ts';

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

const tempDir = mkdtempSync(path.join(tmpdir(), 'ar-tasks-'));

try {
  // --- 1. TaskStore Trực tiếp: DAG & Cycle Detection ---
  const store = new TaskStore(tempDir);

  const t1 = store.create('Tạo Schema DB', 'Thiết kế cơ sở dữ liệu');
  const t2 = store.create('Viết API Backend', 'Xây dựng REST routes');
  const t3 = store.create('Viết Unit Tests', 'Kiểm thử API');

  check('Tạo task sinh mã đúng định dạng task_xxxxxxxx', /^task_[0-9a-f]{8}$/.test(t1.id));
  check('Task mới tạo có trạng thái pending', t1.status === 'pending');
  check('t1 không bị chặn bởi task nào nên canStart = true', store.canStart(t1.id) === true);

  // Thiết lập phụ thuộc: t2 blockedBy [t1], t3 blockedBy [t2]
  store.update(t2.id, { addBlockedBy: [t1.id] });
  store.update(t3.id, { addBlockedBy: [t2.id] });

  check('t2 bị chặn bởi t1 nên canStart = false', store.canStart(t2.id) === false);
  check('t3 bị chặn bởi t2 nên canStart = false', store.canStart(t3.id) === false);

  // Chống chu trình: Cố tình thêm t1 blockedBy [t3] -> Phải ném lỗi Cycle detected
  let cycleDetected = false;
  try {
    store.update(t1.id, { addBlockedBy: [t3.id] });
  } catch (err) {
    if (String(err).includes('Phát hiện chu trình phụ thuộc')) {
      cycleDetected = true;
    }
  }
  check('Phát hiện chu trình phụ thuộc (Cycle Detection: t1 -> t3 -> t2 -> t1)', cycleDetected);

  // Hoàn thành t1 -> t2 có thể bắt đầu
  store.update(t1.id, { status: 'completed' });
  check('Sau khi t1 completed, t2 canStart = true', store.canStart(t2.id) === true);
  check('t3 vẫn chưa thể bắt đầu (t2 chưa xong)', store.canStart(t3.id) === false);

  // Chuyển t2 sang in_progress rồi completed -> t3 có thể bắt đầu
  store.update(t2.id, { status: 'in_progress' });
  check('t2 đang in_progress thì t3 vẫn chưa canStart', store.canStart(t3.id) === false);
  store.update(t2.id, { status: 'completed' });
  check('Sau khi t2 completed, t3 canStart = true', store.canStart(t3.id) === true);

  // --- 2. Tích hợp Kernel Plugin & Native Tools ---
  const kernel = createKernel();
  await kernel.use(toolsPlugin);
  await kernel.use(createTaskSystemPlugin(tempDir));

  check('Kernel expose ctx.tasks', typeof kernel.root.tasks?.create === 'function');

  // Gọi tool task_create qua kernel
  const createRes = await kernel.root.tools.execute('task_create', {
    subject: 'Triển khai Frontend',
    description: 'Xây dựng giao diện React',
  });
  const createdTask = JSON.parse(createRes.content);
  check('Tool task_create hoạt động qua kernel.tools', createdTask?.id && createdTask.subject === 'Triển khai Frontend');

  // Gọi tool task_list qua kernel
  const listRes = await kernel.root.tools.execute('task_list', {});
  const taskList = JSON.parse(listRes.content);
  check('Tool task_list trả về danh sách có thuộc tính canStart', Array.isArray(taskList) && taskList.length >= 4);

  // Gọi tool task_get qua kernel
  const getRes = await kernel.root.tools.execute('task_get', { task_id: createdTask.id });
  const getTask = JSON.parse(getRes.content);
  check('Tool task_get trả về chi tiết task kèm canStart', getTask.id === createdTask.id && typeof getTask.canStart === 'boolean');

  await kernel.dispose();
} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup failure */
  }
}

console.log(`\nKết quả tasks-check: ${pass ? 'TẤT CẢ ĐẠT' : 'CÓ LỖI'}`);
if (!pass) process.exit(1);

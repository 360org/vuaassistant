/**
 * Test in-chat Agent Profile and Soul update tools (§5.6).
 * Ensures agent instructions.md and soul.md are created/updated and read back accurately.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const tempDir = mkdtempSync(path.join(tmpdir(), 'vua-agent-profile-test-'));
process.env.VUA_DATA_DIR = tempDir;
process.env.VUA_AGENT_NAME = 'default';
process.env.VUA_AGENT_WORKSPACE = path.join(tempDir, 'workspace');

const { executeTool } = await import('../src/native-tools/index.ts');

let pass = true;
const check = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) pass = false;
};

// 1. Update instructions for ERP Expert
const res1 = await executeTool('update_agent_profile', {
  agent_name: 'erp-expert',
  title: 'ERP Expert Pro',
  instructions: 'Tuân thủ nghiêm ngặt 100% chuẩn ORM Odoo 17, models.Constraint và XML clean.',
});
check('update_agent_profile creates/updates instructions.md', !res1.is_error && res1.content.includes('ERP Expert Pro'));

// 2. Update soul for ERP Expert
const res2 = await executeTool('update_agent_profile', {
  agent_name: 'erp-expert',
  soul: 'Tính cách điềm đạm, chuyên nghiệp, tập trung vào kiến trúc hệ thống và zero-bug.',
});
check('update_agent_profile creates/updates soul.md', !res2.is_error && res2.content.includes('soul.md'));

// 3. Read back profile
const res3 = await executeTool('read_agent_profile', {
  agent_name: 'erp-expert',
});
check('read_agent_profile returns instructions.md content', !res3.is_error && res3.content.includes('ORM Odoo 17'));
check('read_agent_profile returns soul.md content', !res3.is_error && res3.content.includes('Tính cách điềm đạm'));
check('read_agent_profile returns memory scaffold index', !res3.is_error && res3.content.includes('MEMORY INDEX'));

// Cleanup
try {
  rmSync(tempDir, { recursive: true, force: true });
} catch {}

console.log(pass ? '\n✓ Agent Profile & Soul in-chat update check PASSED' : '\n✗ FAILED');
process.exit(pass ? 0 : 1);

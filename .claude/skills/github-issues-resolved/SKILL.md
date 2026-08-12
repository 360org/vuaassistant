---
name: "github-issues-resolved"
description: "Quét GitHub Issues → phân loại → giao sub agents fix song song → review → merge → done"
argument-hint: "Số issue (VD: 3), label (VD: bug), hoặc bỏ trống = tất cả open issues."
user-invocable: true
disable-model-invocation: false
---

## Mục đích

Quy trình multi-agent tự động: quét issues → phân loại → fan-out sub agents fix song song (worktree cô lập) → review → merge → báo cáo.

## Input

```text
$ARGUMENTS
```

- Số → xử lý issue đó.
- Label (VD: `bug`) → lọc theo label.
- Trống → tất cả open issues.

---

## Quy trình — 6 bước tự động

Khi skill này được gọi, em (Claude chính) sẽ **chạy Workflow tool** với script bên dưới.

### Workflow Script

Gọi Workflow tool với script sau (thay `FILTER` bằng `$ARGUMENTS`):

```
export const meta = {
  name: 'github-issues-resolved',
  description: 'Quét GitHub Issues, fan-out sub agents fix song song, review, merge',
  phases: [
    { title: 'Quét & Phân loại', detail: 'Đọc open issues từ GitHub, phân loại ưu tiên' },
    { title: 'Fix', detail: 'Mỗi issue 1 sub agent trong worktree cô lập' },
    { title: 'Review', detail: 'Review từng fix, kiểm tra chất lượng' },
    { title: 'Merge & Báo cáo', detail: 'Merge branch, đóng issue, tổng hợp báo cáo' }
  ]
}

// === BƯỚC 1: QUÉT ISSUES ===
phase('Quét & Phân loại')

const FILTER = args || ''
const scanPrompt = `
Bạn đang ở repo vuaassistant. Nhiệm vụ:

1. Chạy: git config --get remote.origin.url → xác nhận là GitHub repo.
2. Lấy open issues:
   ${FILTER && !isNaN(FILTER) ? `- gh issue view ${FILTER} --json number,title,body,labels` : FILTER ? `- gh issue list --state open --label "${FILTER}" --json number,title,body,labels --limit 20` : '- gh issue list --state open --json number,title,body,labels --limit 20'}
3. Với mỗi issue, phân loại:
   - priority: "high" nếu label chứa bug/critical/security HOẶC body chứa crash/error/broken
   - priority: "medium" nếu label chứa enhancement/improvement
   - priority: "low" còn lại
4. Sắp xếp theo priority (high → medium → low).

Trả về kết quả theo schema.
`

const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    repo: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['number', 'title', 'body', 'priority']
      }
    }
  },
  required: ['repo', 'issues']
}

const scan = await agent(scanPrompt, { label: 'scan-issues', phase: 'Quét & Phân loại', schema: ISSUES_SCHEMA })

if (!scan || !scan.issues || scan.issues.length === 0) {
  log('✅ Không có open issues nào cần xử lý.')
  return { status: 'no_issues', issues: [] }
}

log(`📋 Tìm thấy ${scan.issues.length} issues: ${scan.issues.map(i => '#' + i.number).join(', ')}`)

// === BƯỚC 2: FIX — mỗi issue 1 sub agent, worktree cô lập ===
phase('Fix')

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    number: { type: 'number' },
    status: { type: 'string', enum: ['fixed', 'skipped', 'failed'] },
    branch: { type: 'string' },
    root_cause: { type: 'string' },
    fix_summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    lines_added: { type: 'number' },
    lines_removed: { type: 'number' },
    tsc_pass: { type: 'boolean' },
    skip_reason: { type: 'string' }
  },
  required: ['number', 'status']
}

const fixes = await pipeline(
  scan.issues,
  issue => {
    const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
    const fixPrompt = `
Bạn đang trong worktree cô lập của repo vuaassistant. Nhiệm vụ: fix GitHub issue #${issue.number}.

## Issue
- Tiêu đề: ${issue.title}
- Nội dung: ${issue.body}
- Labels: ${(issue.labels || []).join(', ')}
- Priority: ${issue.priority}

## Quy trình bắt buộc

1. Tạo branch từ main:
   git checkout -b fix/issue-${issue.number}-${slug}

2. Phân tích:
   - Trace code liên quan (grep, đọc file)
   - Xác định ROOT CAUSE — không fix symptom

3. Fix code:
   - Áp dụng Ponytail: diff ngắn nhất, sửa đúng gốc
   - KHÔNG refactor thêm, KHÔNG thêm dependency
   - KHÔNG sửa gì ngoài scope issue

4. Kiểm tra:
   - npx tsc --noEmit
   - Nếu tsc fail → sửa cho pass

5. Commit:
   git add -A
   git commit -m "fix: mô tả ngắn (#${issue.number})

   Root cause: ...
   Fix: ...

   Closes #${issue.number}
   Co-Authored-By: Claude <noreply@anthropic.com>"

6. Nếu issue mơ hồ hoặc cần thêm thông tin → trả status "skipped" kèm skip_reason.

Trả về kết quả theo schema.
`
    return agent(fixPrompt, {
      label: `fix:#${issue.number}`,
      phase: 'Fix',
      schema: FIX_SCHEMA,
      isolation: 'worktree'
    })
  }
)

const validFixes = fixes.filter(Boolean).filter(f => f.status === 'fixed')
const skipped = fixes.filter(Boolean).filter(f => f.status !== 'fixed')

log(`🔧 Fixed: ${validFixes.length} | Skipped/Failed: ${skipped.length}`)

if (validFixes.length === 0) {
  return { status: 'nothing_fixed', fixes, skipped }
}

// === BƯỚC 3: REVIEW — kiểm tra chất lượng từng fix ===
phase('Review')

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    number: { type: 'number' },
    approved: { type: 'boolean' },
    quality_score: { type: 'number' },
    issues_found: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  },
  required: ['number', 'approved', 'quality_score', 'summary']
}

const reviews = await pipeline(
  validFixes,
  fix => {
    const reviewPrompt = `
Bạn là code reviewer cho repo vuaassistant. Review fix cho issue #${fix.number}.

## Thông tin fix
- Branch: ${fix.branch}
- Root cause: ${fix.root_cause}
- Fix: ${fix.fix_summary}
- Files: ${(fix.files_changed || []).join(', ')}
- Diff: +${fix.lines_added || 0} / -${fix.lines_removed || 0}

## Checklist review
1. Chạy: git log --oneline -3 ${fix.branch} 2>/dev/null || git log --oneline -3
2. Chạy: git diff main..${fix.branch} -- . 2>/dev/null || git diff HEAD~1
3. Đọc diff và đánh giá:
   - Fix đúng root cause hay chỉ fix symptom?
   - Diff có ngắn nhất có thể không?
   - Có break chức năng khác không?
   - Code style có nhất quán với project không?
   - Có thêm dependency không cần thiết không?
4. Cho điểm quality_score từ 1-10.
5. approved = true nếu score >= 7.

Trả về kết quả theo schema.
`
    return agent(reviewPrompt, {
      label: `review:#${fix.number}`,
      phase: 'Review',
      schema: REVIEW_SCHEMA
    })
  }
)

const approved = reviews.filter(Boolean).filter(r => r.approved)
const rejected = reviews.filter(Boolean).filter(r => !r.approved)

log(`✅ Approved: ${approved.length} | ❌ Rejected: ${rejected.length}`)

// === BƯỚC 4: MERGE & BÁO CÁO ===
phase('Merge & Báo cáo')

const mergeResults = []
for (const review of approved) {
  const fix = validFixes.find(f => f.number === review.number)
  if (!fix) continue

  const mergePrompt = `
Bạn đang ở repo vuaassistant trên branch main. Nhiệm vụ: merge fix cho issue #${fix.number}.

1. Kiểm tra branch tồn tại: git branch --list "${fix.branch}"
2. Nếu tồn tại:
   - git merge ${fix.branch} --no-ff -m "merge: fix #${fix.number} - ${fix.fix_summary}"
   - git branch -d ${fix.branch}
3. Nếu KHÔNG tồn tại (do worktree cô lập):
   - Trả status "needs_manual_merge" — các thay đổi nằm trong worktree và cần được áp dụng thủ công.

Trả về kết quả theo schema.
`
  const mergeResult = await agent(mergePrompt, {
    label: `merge:#${fix.number}`,
    phase: 'Merge & Báo cáo',
    schema: {
      type: 'object',
      properties: {
        number: { type: 'number' },
        merged: { type: 'boolean' },
        status: { type: 'string' }
      },
      required: ['number', 'merged', 'status']
    }
  })
  mergeResults.push(mergeResult)
}

// === KẾT QUẢ CUỐI ===
return {
  status: 'completed',
  total_issues: scan.issues.length,
  fixed: validFixes.length,
  approved: approved.length,
  rejected: rejected.length,
  skipped: skipped.length,
  details: {
    fixes: validFixes,
    reviews: approved,
    rejected_reviews: rejected,
    skipped_issues: skipped,
    merges: mergeResults.filter(Boolean)
  }
}
```

### Sau khi Workflow hoàn thành

Em (Claude chính) đọc kết quả workflow và tổng hợp báo cáo cho Sếp theo format:

```markdown
# 📊 Báo cáo GitHub Issues Resolved

## Tổng quan
| Metric | Số lượng |
|--------|----------|
| Issues quét được | X |
| Đã fix | Y |
| Review approved | Z |
| Merged | W |
| Skipped/Rejected | N |

## Chi tiết từng issue

### ✅ Issue #5 — Sidebar crash khi resize
- **Priority:** 🔴 Cao
- **Root cause:** useEffect thiếu cleanup
- **Fix:** Thêm cleanup (+2 / -0)
- **Files:** `src/components/Sidebar.tsx`
- **Review:** 9/10 ✅
- **Merge:** ✅ Đã merge vào main

### ⏭️ Issue #8 — (Skipped)
- **Lý do:** Issue mơ hồ, cần Sếp cung cấp thêm thông tin

### ❌ Issue #12 — (Rejected)
- **Lý do review reject:** Fix chỉ giải quyết symptom, chưa đúng root cause
- **Đề xuất:** Cần phân tích sâu hơn, em sẽ xử lý lại nếu Sếp yêu cầu

## Hành động tiếp theo
- Issues rejected → Sếp muốn em fix lại không?
- Issues skipped → Sếp bổ sung thông tin giúp em
- OK hết → em push lên remote
```

---

## Quy tắc bắt buộc

1. **Worktree cô lập** — mỗi sub agent fix trong worktree riêng, không conflict nhau.
2. **Review bắt buộc** — fix nào score < 7 sẽ bị reject, không merge.
3. **Không tự push** — merge local xong chờ Sếp xác nhận rồi mới push remote.
4. **Không refactor** — chỉ fix đúng scope issue, không "tiện tay" đổi thứ khác.
5. **Không thêm dependency** trừ khi issue yêu cầu rõ ràng.
6. **Skip nếu mơ hồ** — issue thiếu thông tin thì skip kèm lý do, không đoán mò.

# CHANGELOGS: Nhật ký Phát triển VuaAssistant (Zero-Docker / Đa nền tảng)

Nhật ký ghi lại các cột mốc thay đổi kiến trúc và tái cấu trúc hệ thống.

## [1.1.68] — 2026-08-26

### Vá Lỗi Approval Loop & Chặn Lộ Vault Credential
*   **[SECURITY] Redact Vault/Credential khỏi toàn bộ chat output:**
    *   Chặn hiển thị `vault-entry:*`, `{{credential:*}}`, token/password và ID nội bộ Vault trong prompt hệ thống, transcript runner, outbound response và UI `MessageContent`.
    *   Giao diện approval card chỉ còn thấy nhãn an toàn thay vì placeholder credential thô.
*   **[FIX] Không xin quyền lặp lại sau khi Sếp đã duyệt:**
    *   Nút duyệt capability gửi marker máy đọc được `CALL_APPROVED_CAPABILITY:<tool>` và runner chỉ cấp quyền cho đúng tool đã duyệt.
    *   `connector_request` hỗ trợ cờ `approved=true` ở cả host runner và runtime tool để không bị kẹt vòng lặp xin quyền cùng một hành động.
*   **[IMPROVE] Kiểm thử regression cho đường biên bảo mật:**
    *   Bổ sung self-check `approval-redaction.self-check.ts` vào `agent-runner npm run check` để khóa hành vi: duyệt đúng tool, không lan quyền sang tool khác và luôn redact credential khỏi text hiển thị.
    *   Làm bền `desktop-oauth-check.mjs` khi đã có AI Router sidecar đang chạy chậm trên port `36360`, tránh spawn trùng gây `EADDRINUSE` giả.

## [1.1.67] — 2026-08-26

### Nâng Cấp Trải Nghiệm Chat, Profile & 360 CORP SSO
*   **[NEW] Nâng cấp Bot Avatar & User Profile Chat Bubble:**
    *   Nâng cấp icon AI Bot dạng High-Tech Container bo góc hiện đại `rounded-xl`, gradient công nghệ kết hợp đèn tín hiệu hoạt động `animate-ping` thời gian thực.
    *   Bổ sung User Avatar hiển thị bên phải tin nhắn của người dùng (đối diện với Bot) kèm huy hiệu nhận diện đồng bộ `360 CORP SSO`.
*   **[NEW] Module Quản lý Hồ sơ Người dùng & Tích hợp 1-Click 360 CORP SSO (`UserProfileModal`):**
    *   Bổ sung modal quản lý thông tin định danh cục bộ (Họ tên, Email, Số điện thoại, Tổ chức).
    *   Tích hợp nút đăng nhập 1-Click SSO kết nối trực tiếp với trung tâm xác thực `auth_sso_center` tại `https://vuahethong.net/vuaoffice/auth`.
    *   Tự động khởi tạo local profile và đồng bộ trạng thái tài khoản với đám mây Vua Hệ Thống mà không cần đăng ký thủ công nhiều lần.
*   **[IMPROVE] Đồng bộ & Mở rộng Store `LocalUser`:**
    *   Mở rộng interface `LocalUser` trong `src/lib/store.tsx` hỗ trợ lưu trữ chi tiết: `email`, `phone`, `avatar`, `ssoToken`, `organization`, `syncedWithVuahethong`, `lastSyncedAt`.
    *   Sidebar hiển thị trạng thái tài khoản và biểu tượng badge SSO thời gian thực.
*   **[FIX] Hoàn thiện Bộ Kiểm thử OAuth Providers:**
    *   Bổ sung kiểm thử PKCE authorize và token exchange cho OpenAI Codex, Antigravity, Claude và OpenRouter trong `scripts/desktop-oauth-check.mjs`.

## [1.1.66] — 2026-08-25

### Mở rộng Kiến trúc Kernel: Hooks Lifecycle & Persistent Task DAG
*   **Hooks Lifecycle Plugin (`hooksPlugin` — s04_hooks pattern):**
    *   Thêm `agent-runner/src/plugins/hooks.ts` cho phép đăng ký lắng nghe và can thiệp vào các mốc vòng đời của Agent: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `TurnComplete`.
    *   Tự động liên kết với thác nước `tools/pre-execute` để chặn các lệnh gọi tool không an toàn hoặc ghi nhận nhật ký thực thi (duration, kết quả).
    *   Hỗ trợ Disposer theo chuẩn Effect Discipline để gỡ sạch sẽ không để lại rác khi plugin tắt.
*   **Task System Plugin (`taskSystemPlugin` — s10_task_system pattern):**
    *   Thêm `agent-runner/src/plugins/tasks.ts` quản lý đồ thị tác vụ phụ thuộc (Task DAG) bền vững trên đĩa tại `.tasks/`.
    *   Hỗ trợ vòng đời tác vụ rõ ràng: `pending` ➔ `in_progress` ➔ `completed`.
    *   Thuật toán phát hiện chu trình phụ thuộc (Cycle Detection) chống lặp vô tận khi cấu hình `blockedBy`.
    *   Tự động tính toán trạng thái `canStart` cho từng task dựa trên trạng thái của các task phụ thuộc.
    *   Cung cấp bộ 4 công cụ tương tác: `task_create`, `task_update`, `task_get`, `task_list` được tích hợp vào `ctx.tools`.
*   **Bộ Kiểm thử Tự động & Contract Checks Mở rộng:**
    *   Thêm `agent-runner/scripts/hooks-check.mjs` (5 assertions) và `agent-runner/scripts/tasks-check.mjs` (14 assertions) kiểm chứng 100% các kịch bản thực thi, chặn tool, phát hiện chu trình và gỡ sạch plugin.
    *   Nâng tổng số bài kiểm thử của Agent Runner từ 27 lên 29 bài test tự động (tất cả 100% PASS).

## [1.1.65] — 2026-08-25

### Chuẩn hóa Cấu trúc Tài liệu & Multi-Agent Protocol
*   **Chuẩn hóa Phân bổ Tài liệu AIaC 3.0 (`docs/*`):**
    *   Tái cấu trúc thư mục tài liệu: chuyển toàn bộ các tệp chi tiết vào `docs/` (`docs/ARCH.md`, `docs/SPEC.md`, `docs/IDEA.md`, `docs/DEPLOY_GUIDE.md`, `docs/CHANGELOGS.md`, `docs/CHECKLIST.md`, `docs/HARNESS-PLAN.md`, `docs/AUDIT.md`, `docs/DEVELOPMENT.md`, `docs/SECURITY.md`...).
    *   Giữ thư mục Root tinh gọn tuyệt đối theo chuẩn (chỉ gồm `README.md`, `AGENTS.md`, `.claude/`).
*   **Quy chuẩn Điều phối Multi-Agent (`AGENTS.md`):**
    *   Bổ sung tài liệu `AGENTS.md` tại thư mục Root, chuẩn hóa phân bổ vai trò, model assignment và nguyên tắc "Everything is a Plugin" lấy cảm hứng từ DeepSeek Harness và Learn Claude Code.

## [1.1.64] — 2026-08-24

### Kỷ luật Kernel & Dọn dẹp Mã nguồn
*   **Kỷ luật Sổ Đăng ký Skill (Kernel Invariant):**
    *   `skills.register()` ném lỗi ngay lập tức khi phát hiện trùng tên skill thay vì im lặng ghi đè làm sai lệch hành vi.
    *   Bổ sung Invariant `skills` vào Kernel Invariant Registry (`agent-runner/src/kernel/skills.ts`): Bắt buộc mọi tool mà skill khai báo phải có mặt trong sổ `ctx.tools`. Ngăn chặn hoàn toàn lỗi cấu hình tool ma hoặc tool ngoại vi chưa được cấp phép.
    *   Cập nhật thứ tự nạp plugin trong `agent-runner/src/kernel/compose.ts` (`invariantsPlugin` nạp trước) để đảm bảo mọi invariant được nạp sẵn sàng trước khi nạp các plugin nghiệp vụ.
*   **Tối ưu Frontend & Dọn dẹp Mã chết:**
    *   Loại bỏ 3 tệp mã chết không còn sử dụng: `ChatComposer.tsx`, `ChatMessageList.tsx`, `AgentStateContext.tsx`.
    *   Tách `FilePreviewModal.tsx` thành sub-component độc lập trong `src/components/chat/modals/`, giúp module `Chat.tsx` tinh gọn và dễ bảo trì.
*   **Sạch sẽ Cảnh báo Rust Backend:**
    *   Gắn `#[cfg(target_os = "macos")]` cho hàm `hex_encode` trong `src-tauri/src/auth.rs`, giúp `cargo check` sạch 100% cảnh báo trên mọi nền tảng (0 errors, 0 warnings).
*   **Cập nhật Kiểm chứng Native Tools Policy:**
    *   Cập nhật đếm động 17 native tools trong `agent-runner/scripts/native-tools-policy-check.mjs`.

## [1.1.63] — 2026-08-23

### Tùy biến Hồ sơ & Tính cách Agent trong Chat (In-Chat Agent Profile & Soul)
*   **In-Chat Agent Profile & Soul Customization:**
    *   Người dùng có thể ra lệnh tự nhiên trong hội thoại để cập nhật trực tiếp Kim chỉ nam (`instructions.md`) và Tính cách/Giọng điệu (`soul.md`) của Agent.
    *   Bổ sung 2 native tools `update_agent_profile` và `read_agent_profile` trên Host Process Runner, tự động ghi file trực tiếp xuống thư mục `agents/<agentName>/` và phát sự kiện IPC `agent_update` để đồng bộ tức thì lên giao diện React.
*   **Trình xem & Soạn thảo Kịch bản Skill (Skill Detail View & Direct Editor):**
    *   Bổ sung `SkillDetailModal` trên giao diện mục **Skills**, cho phép xem chi tiết toàn bộ nội dung kịch bản, metadata và chỉnh sửa trực tiếp nội dung `SKILL.md` đối với Custom Skills.
*   **Kiểm chứng CI & Bộ nhớ Tự học (Self-Improve CI Fix):**
    *   Sửa lỗi script `self-improve-check.mjs` nạp trực tiếp từ `src/` thay vì `dist/`, giải quyết triệt để lỗi CI fail trên GitHub Actions.
    *   Bổ sung `scripts/agent-profile-check.mjs` vào bộ kiểm thử CI tổng thể `npm run check`.

## [1.1.62] — 2026-08-23

### Kiến trúc Executable Skills & In-Chat Lifecycle (DeepSeek Harness style)
*   **Skill thực thi gắn trực tiếp Plugin/Tool (Executable Skills):** Hỗ trợ khai báo `tools: [...]` và `vua-tools` trong YAML frontmatter của `SKILL.md`. Bổ sung `skillsPlugin` và `SkillRegistry` vào Kernel runtime (`agent-runner/src/kernel/skills.ts`) để bind động capabilities khi kích hoạt skill.
*   **Vòng đời Skill trong Chat (In-Chat Lifecycle):** Bổ sung native tools `create_or_update_skill` và `read_skill_file` cho phép Agent tự động tạo, lưu file đĩa và chỉnh sửa nội dung Skill trực tiếp theo câu lệnh của người dùng trong hội thoại.
*   **Hot-Reload trạng thái qua SQLite IPC:** Đồng bộ sự kiện `skill:updated` tức thì lên React Store mà không cần khởi động lại ứng dụng.
*   **Kiểm chứng Hợp đồng:** Bổ sung `scripts/executable-skills-check.mjs` vào quy trình test tổng thể `npm run check`.

## [1.1.56] — 2026-08-07

### Tối ưu hóa Trải nghiệm Kết nối (UX Models Load)
*   **Tự động Verify kết nối sau khi đăng nhập:** Sửa đổi `saveConnectionAndCleanupDuplicates` tự động trigger kiểm tra kết nối API (`testAiRouterConnection`) ngay khi đăng nhập OAuth hoặc thêm API Key thành công. Loại bỏ thao tác bắt người dùng phải bấm "Test API" thủ công mới load được danh sách models trong Chat.

## [1.1.55] — 2026-08-07

### Sửa lỗi build release
*   **Fix lỗi TypeScript chặn build macOS (v1.1.54):** Xoá 3 import thừa (`saveAiRouterConnection`, `fetchVendorAccount`, `vaultSet`) trong `ModelSettings.tsx` gây lỗi `TS6133` khiến bước `tsc` fail trên CI, chặn toàn bộ release v1.1.54.
*   **Sắp xếp lại thứ tự build macOS:** Build Intel (`x86_64-apple-darwin`) chạy trước Apple Silicon (`aarch64-apple-darwin`) trong job `build_macos`.

## [1.1.53] — 2026-08-06

### Tích hợp cổng 36360 & Tối ưu hóa Bộ nhớ
*   **Hợp nhất cấu hình cổng 36360:** Chuyển đổi toàn bộ dịch vụ AI Router và các tệp kiểm thử hợp đồng sang cổng chuẩn `36360` để đồng bộ thương hiệu 360org.
*   **Dọn dẹp môi trường Docker:** Gỡ bỏ các tệp tin cấu hình Docker và Colima (`docker-compose.yml`, `Dockerfile`, `dev.sh`...) thừa thãi nhằm cam kết tuyệt đối triết lý Zero-Docker cho người dùng và lập trình viên.
*   **Tính năng Tự học & Tóm tắt bộ nhớ (Self-improving Memory):** Tự động tóm tắt tệp bộ nhớ `learned.md` của Agent khi vượt quá 30 mục và hỗ trợ công cụ tìm kiếm bộ nhớ cục bộ `search_memory`.
*   **Cấu hình thư mục làm việc (Workspace Path):** Bổ sung Tauri command `set_workspace_path` và giao diện cấu hình đường dẫn thư mục lưu trữ dữ liệu của Agent, tự động cập nhật và restart runner khi thay đổi.
*   **Bảo đảm tính ổn định:** Chạy bộ kiểm thử toàn diện và cargo check trên `main` đạt 100%.

## [1.1.52] — 2026-08-04

### Tính năng Reply, Retry & Tối ưu hóa Lưu trữ
*   **Hành động Reply & Retry trực quan:** Bổ sung hai nút "Trả lời" (trích dẫn tin nhắn dạng blockquote) và "Thử lại" (gửi lại yêu cầu trước đó) trực tiếp bên dưới các bong bóng chat của AI.
*   **Thư mục dữ liệu thương hiệu `~/vuaai-data`:** Chuyển đổi toàn bộ thư mục lưu trữ dữ liệu mặc định từ tệp ẩn `.vuaassistant/data` sang thư mục nổi `~/vuaai-data` để tăng tính nhận diện thương hiệu và giúp người dùng dễ quản lý.
*   **Tự động Code Sign & Notarize:** Cấu hình tự động ký và chứng thực bảo mật với Apple trên GitHub Actions khi phát hành, khắc phục triệt để lỗi "unidentified developer" trên macOS.
*   **Khắc phục lỗi cổng AI Router:** Chuyển cổng mặc định trong sidecar sang `36360` đồng bộ hoàn toàn với hệ thống, sửa lỗi AI Router bị tắt sau khi mở.

## [1.1.50] — 2026-08-04

### Sửa lỗi kiểm tra sức khỏe AI Router trên Windows (HTTP 400 Bad Request)

*   **Sửa lỗi cú pháp healthcheck (Issue #10):** Thay thế ký tự ngắt dòng thô `\\r\\n` bằng byte
    Carriage Return và Line Feed (`\r\n`) chuẩn trong HTTP request gửi qua `TcpStream` của Rust backend.
    Sửa lỗi AI Router nhận request không hợp lệ (malformed) trả về `400 Bad Request` dẫn đến việc app
    tưởng AI Router chưa sẵn sàng và tự động kill tiến trình con ngay sau khi spawn.
*   **Sửa lỗi phân giải binary name trong Smoke Test:** Đổi tên file tìm kiếm từ `VuaAssistant.exe`
    thành `vuaassistant.exe` trong workflow kiểm thử cài đặt tự động trên GitHub Actions để test khói chạy đúng.

## [1.1.49] — 2026-08-04

### Hotfix Windows AI Router

*   AI Router chờ endpoint `/health` sẵn sàng trước khi báo khởi động thành công;
    lỗi startup kèm log tail để chẩn đoán.
*   Onboarding polling health tối đa 10 giây sau restart thay vì chờ cứng 2,5 giây,
    tránh kẹt ở bước đăng nhập AI account.
*   Không kill bừa process ngoài khi port `20128` bị chiếm; chỉ dừng đúng process
    AI Router có `sidecar.mjs`.
*   Windows release smoke test bắt buộc kiểm tra `vuaassistant.exe`, `sidecar.mjs`,
    Agent Runner `index.js` và `node.exe` sau cài đặt.

### Kiểm chứng

*   `npm run check` đạt toàn bộ; contract resource/runtime, OAuth, Host Process,
    credential boundary, connector, isolation và RAG đều đạt.

## [1.1.48] — 2026-08-04

### Sửa lỗi đường dẫn Runtime & Khởi động AI Router trên Windows

*   **Sửa lỗi phân giải thư mục tài nguyên (Issue #7 & #8):** Cập nhật hàm `resolve_project_dir` trong
    Rust backend để phát hiện và tìm đúng thư mục tài nguyên `_up_` giải nén cùng cấp với file thực thi chính
    (`vuaassistant.exe`) trên Windows. Sửa lỗi AI Router và Agent Runner không thể khởi động được (Đang dừng)
    sau khi cài đặt app thực tế trên Windows 11.
*   **Sửa lỗi typo Smoke Test:** Đổi tên file tìm kiếm từ `VuaAssistant.exe` thành `vuaassistant.exe` trong
    workflow kiểm thử cài đặt tự động trên GitHub Actions để test khói chạy đúng.

## [1.1.47] — 2026-08-04

### Desktop menu, updater và checklist

*   Bổ sung cấu trúc native menu cho macOS gồm VuaAssistant, File, Edit, View,
    Window và Help để chuẩn hóa trải nghiệm desktop.
*   Cho phép cấp quyền đọc từ file hoặc thư mục được chọn trong native picker;
    path được canonicalize trước khi lưu vào approved-read-paths.
*   Đưa App Update Section lên đầu Settings và đưa nút Update rõ ràng lên
    Sidebar; bản local build tắt updater artifacts để phân biệt với release build.
*   Bổ sung checklist multi-task/multi-sub-agent và skill `github-issues-resolved`
    cho quy trình quét, phân loại, fix và merge GitHub Issues.

### Kiểm chứng

*   `npm run check` đạt trên `main` sau merge, gồm desktop bundle, OAuth,
    Host Process, AI Router, credential boundary, connector, isolation và RAG.

## [1.1.46] — 2026-08-04

### Sửa lỗi chớp tắt PowerShell & Giám sát AI Router trên Windows

*   **Sửa lỗi chớp tắt cửa sổ console (Issue #6):** Thêm cờ `CREATE_NO_WINDOW` (`0x08000000`)
    cho mọi tiến trình con (`powershell`, `node`, `taskkill`) được gọi trên Windows, ngăn chặn hoàn toàn
    tình trạng nháy cửa sổ PowerShell màu đen khó chịu khi mở ứng dụng.
*   **Sửa lỗi kẹt port AI Router trên Windows:** Bổ sung cơ chế tự động tìm và giải phóng (kill)
    tiến trình đang chiếm port `20128` trên Windows trong hàm `kill_stale_port_process` trước khi bind lại,
    tránh lỗi `AI Router unavailable` khi chạy app mới.
*   **Sửa lỗi crash khi click Sign In trên Windows WebView2:** Thay thế phương thức `AbortSignal.timeout()` bằng
    cơ chế `AbortController` và `setTimeout` truyền thống nhằm tương thích ngược 100% với
    các phiên bản WebView2 cũ, ngăn chặn crash giao diện khi bấm Login.
*   **Giám sát trạng thái AI Router & Agent Runner:** Thêm mục giám sát trạng thái trực quan
    tại phần Settings -> Chẩn đoán (`AI Router: 🟢 Đang chạy` / `🔴 Đang dừng`, `Agent Runner: 🟢 Đang chạy` / `🔴 Đang dừng`).
*   **Thêm nút restart phục hồi AI Router:** Cho phép người dùng click khởi động lại AI Router trực tiếp
    ở giao diện Chẩn đoán. Đồng thời nút "Thử lại" khi gặp lỗi kết nối AI Router giờ sẽ tự động gọi restart
    AI Router sidecar trước khi kết nối lại.

## [1.1.45] — 2026-08-03

*   Bản build thử nghiệm nội bộ cho AbortSignal timeout.

## [1.1.44] — 2026-08-03

*   Bản build thử nghiệm nội bộ của AbortSignal timeout.

## [1.1.43] — 2026-08-03

### Vá lỗi tương thích Windows

*   **Sửa lỗi cài đặt NSIS (`nsis_tauri_utils.dll` could not load):** Cấu hình chế độ
    cài đặt NSIS mặc định sang `currentUser` (không đòi hỏi quyền Admin cao cấp cho việc ghi DLL tạm thời),
    đồng thời tích hợp thêm kiểm thử khói cài đặt âm thầm (smoke-test silent install)
    vào CI để phát hiện sớm các lỗi đóng gói trên Windows.
*   **Sửa lỗi kết nối OAuth AI Router:** Thêm cơ chế tự động kết nối health-check và restart
    AI Router sidecar (chờ tối đa 2.5s) trước khi cho phép bắt đầu luồng đăng nhập thủ công,
    tránh lỗi thô "Failed to fetch" khi AI Router khởi động chậm trên môi trường Windows.
*   **Ngăn chặn lỗi đứng màn hình Onboarding:** Thêm cơ chế phòng vệ tại bước kết thúc Onboarding
    khi `provider === null` (đăng nhập bị ngắt quãng hoặc fail một phần) bằng cách hiển thị thông báo lỗi
    tiếng Việt và trả người dùng về màn hình Login để thử lại.

### Giao diện Sidebar

*   Hiển thị phiên bản hiện tại cạnh tên VuaAssistant trên Sidebar.
*   Giữ thông báo có bản cập nhật tại khu vực Cài đặt, tránh hiển thị cùng một
    thông tin ở hai vị trí.

## [1.1.42] — 2026-08-02

### Lớp capability local học từ OpenWork

*   **Capability rail nội bộ cho Agent Runner:** thêm hai tool chuẩn `search_capabilities`
    và `execute_capability` để gom native tools, built-in delivery tools và MCP tools
    vào một bề mặt tìm/chạy thống nhất. Agent có thể tìm khả năng trước khi chọn
    tool cụ thể, giảm hardcode khi thêm Skills, Connectors hoặc MCP mới.
*   **Cổng duyệt cho thao tác outward-facing/credentialed:** capability gửi tin,
    gửi file ra kênh ngoài, sửa message hoặc gọi connector có credential bị chặn bằng
    `APPROVAL_REQUIRED` nếu chưa có `approved=true`; Runner dừng lượt để chờ người dùng
    duyệt, không cho model tự retry trong cùng vòng tool. Ghi/sửa file trong workspace và
    lập lịch nội bộ vẫn chạy ngay theo `idea.md`, vì đó là capability cốt lõi đã được cấp.
*   **Skill Store có nguồn/version:** parser và trang Skills giữ nguồn cài đặt
    của từng skill (`built-in`, URL import hoặc skill tự tạo) cùng metadata version nếu
    có, giúp người dùng biết skill đến từ đâu trước khi bật/dùng.
*   **Onboarding remote MCP bằng URL:** Settings → MCP cho phép dán URL remote MCP và tự
    sinh cấu hình `npx -y mcp-remote <url>`. OAuth/token do bridge xử lý, không đưa
    secret vào prompt Agent.
*   **Gói chẩn đoán hỗ trợ đã che secret:** Settings có mục Diagnostics hiển thị
    số lượng Skills/MCP/Knowledge/Scheduled và copy gói hỗ trợ đã che API key, token,
    password, credential để debug local runtime an toàn.
*   **Kiểm chứng:** thêm `agent-runner/scripts/capability-rail-check.mjs` và nối vào
    `agent-runner` test/check; root build VuaAssistant đã pass sau thay đổi.

## [1.1.41] — 2026-08-02

### Agent Runner và an toàn đường dẫn

*   Telegram chuyển message vào hàng đợi SQLite `messages_in`; Runner xử lý
    và phát reply qua `messages_out`, không còn bypass IPC bằng cách gọi trực tiếp
    agent loop.
*   Thêm các capability `ask_user_question`, `schedule_message`,
    `list_scheduled`, `cancel_scheduled` cho câu hỏi tương tác và tác vụ định kỳ.
*   Chuẩn hóa lexical path và realpath của mọi `approved_roots` trước kiểm tra
    containment trong Tauri filesystem boundary, đóng đường path traversal tương đối.
*   RAG, Scheduler và self-improve memory đã chạy trong Host Process, nên không
    dừng khi người dùng đóng cửa sổ webview.

### Native desktop

*   Thêm plugin global shortcut cho macOS: ẩn/hiện cửa sổ, reload và phát sự kiện
    shortcut vào webview.
*   Thêm cập nhật checklist cho Planning, Self-correction và Task Completion.

### Kiểm chứng

*   `npx tsc --noEmit` và `npx tsc --project agent-runner/tsconfig.json --noEmit` đạt.
*   `cargo check --quiet` đạt.
*   `npm run build` đạt với 2.009 module.

## [1.1.40] — 2026-08-01

### Tài liệu khớp lại thực tế (audit theo `vuaassistant-dev-guidelines`)

*   `CHECKLIST.md`: tick lại mục "Move Telegram, scheduled jobs, and RAG
    execution behind the host/Runner" — đã xong từ trước (`agent-runner/src/index.ts`
    gọi `startScheduler()`/`startTelegramChannel()`, RAG đọc thẳng `knowledge.db`
    trong `agent-runner/src/knowledge/index.ts`), checklist ghi `[ ]` là lỗi thời.
*   `skills/vuaassistant-dev-guidelines/SKILL.md` §0.45: sửa dòng liệt kê
    "Còn lại: selfImprove, Knowledge/RAG" — cả hai đã di trú xong vào
    `agent-runner/`, không còn dở dang.
*   **MCP cấu hình được từ Settings:** người dùng tự khai báo server đã tin cậy
    bằng tên, executable và arguments cố định. Tauri truyền cấu hình này vào
    `runner.json`; Agent Runner chỉ nạp tools MCP mà server khai báo, không mở
    lại host shell cho model.
*   **Bản app native tự đủ runtime:** `build:local` tự nạp Node 24 theo kiến trúc
    macOS trước khi bundle. Native smoke ngày 2026-07-29 xác nhận AI Router và
    Agent Runner chạy từ `VuaAssistant.app/Contents/Resources/_up_/runtime/node/node`,
    không còn dùng Node cài trên iMac. CI cũng bỏ kiểm tra `better-sqlite3` lỗi thời
    vì Runner đã dùng `node:sqlite`.
*   **Lịch & Nhiệm vụ chuyển Kanban:** thay danh sách dài bằng ba cột Đang chạy,
    Tạm dừng và Cần chú ý. Mỗi card giữ thao tác pause/tiếp tục, lịch sử và xoá;
    job có lần chạy mới nhất lỗi chỉ xuất hiện trong cột Cần chú ý.
*   **Popup cấu hình tác vụ:** nhấp card Kanban hoặc nhấn Enter/Space để mở modal
    chỉnh tên, prompt, lịch chạy và trạng thái bật/tạm dừng. Nút thao tác nhanh
    trên card không mở popup, giữ nguyên pause, lịch sử và xoá.
*   **Tag và filter Lịch & Nhiệm vụ:** task có tag tự do (nhập bằng dấu phẩy) từ
    lúc tạo hoặc trong popup cấu hình. Board hiển thị tag và lọc kết hợp theo
    trạng thái/tag, có một nút xóa toàn bộ điều kiện lọc. Filter dùng dropdown
    checkbox tối nền, số lượng tag và thao tác Bỏ chọn giống Model Pack; không
    dùng native `<select>` mặc định của hệ điều hành.
*   **Task Workspace nhiều view:** thêm thanh chuyển Grid, Board, Calendar, List,
    Status và Charts. Calendar theo bố cục Planner có điều hướng tháng, lưới 7 ngày,
    task chạy theo lịch và panel tác vụ chưa có lịch; mọi task trong các view đều mở
    cùng popup cấu hình. Charts chỉ tổng hợp `TaskRunLog` thật và hiện empty state
    khi Scheduler chưa ghi nhận run nào.
*   **Danh mục tag dùng chung:** thay ô nhập tag tự do từng task bằng bộ chọn
    multi-select từ catalog tag chung. Tag mới chỉ được tạo có chủ đích qua nút Thêm,
    sau đó xuất hiện để chọn lại ở mọi task; dữ liệu tag cũ tự được gom vào catalog.
*   **Popup tag rõ nét theo theme:** selector tag chuyển sang chip checkbox có nền,
    viền và trạng thái chọn riêng cho sáng/tối; typography tăng độ đậm và tương phản.
    Ô tạo tag tách thành hàng phụ rõ ràng, không còn bị lẫn với chip selection.
*   **Nút đóng lỗi Provider dễ thấy:** banner xác thực thất bại dùng nút đóng 28px,
    có viền/nền, ký tự × đậm, tooltip và focus ring thay cho ký tự × 11px khó bấm.
*   **Sửa vòng tool Gemini:** Agent Runner đưa user turn vào transcript trước request
    đầu tiên. Khi model gọi tool, history gửi lại giữ đúng `user → function call →
    function response`; không còn gửi function call mồ côi khiến Gemini/Antigravity
    trả HTTP 400 `INVALID_ARGUMENT`. Thêm regression check cho thứ tự này.
*   **Phát hành đa nền tảng:** một tag `v*` giờ dựng và chỉ công bố release sau khi
    hoàn tất bốn installer: macOS Apple Silicon, macOS Intel, Windows x64 và Linux
    x64. Mỗi bundle tự mang Node 24 đúng kiến trúc, AI Router cùng Agent Runner;
    Windows dùng `node.exe` trong tài nguyên đóng gói. Workflow build/ký trực tiếp
    bằng Tauri CLI và upload tuần tự bằng GitHub CLI, tạo `latest.json` từ chữ ký
    updater của đủ bốn nền tảng bằng secret của repository.

## [1.1.3] — 2026-07-27

### Quy trình phát hành

*   **Bỏ tự động tag.** Workflow trước đây tag một bản patch mới cho **mọi** lần push lên
    `main`, nên kho có **233 tag** cho vài lần phát hành thật. Nay chỉ chạy khi có tag `v*`
    được đẩy lên, và tag phải khớp `package.json` — nếu lệch thì dừng ngay.
    Commit chỉ đi vào CHANGELOGS; tag là quyết định của PO.
*   **Sửa lỗi build im lặng.** `tauri-action` chọn trình quản lý gói theo lockfile; kho có
    `pnpm-lock.yaml` nên nó chạy `pnpm tauri build`, trong khi runner chỉ có npm — job chết
    sau 1 giây, không một dòng lỗi biên dịch nào. Hai bản phát hành gần nhất đều hỏng vì
    chuỗi lỗi này (bản trước nữa hỏng ở bước kiểm chứng `better_sqlite3.node`, nay đã gỡ).

### Bộ não chuyển hẳn sang Host Process (idea.md §1.3)

Đóng cửa sổ app thì lịch vẫn phải chạy, Telegram vẫn phải trả lời. Trước đây cả bốn
hệ con đều nằm trong webview nên đóng app là tắt hết. Nay đã di trú xong toàn bộ:

*   **Scheduler** → `agent-runner/src/scheduler/`. App sở hữu danh sách nhiệm vụ,
    runner sở hữu việc thực thi và ghi `lastRun` vào `session_state` — không bên nào
    ghi vào kho của bên kia.
*   **Telegram** → `agent-runner/src/channels/telegram.ts`. Telegram nhét bot token
    trong URL path, mà Connector Gateway cấm credential trong URL, nên **AI Router giữ
    token** và mở 3 endpoint không lộ token (`/v1/channels/telegram/{status,updates,send}`);
    runner chỉ điều khiển. Token không bao giờ rời router.
*   **selfImprove** → `agent-runner/src/memory/self-improve.ts`. Ghi vào cây memory của
    chính role (`agents/<tên>/memory/memories/learned.md`), áp dụng cho cả hội thoại
    Telegram. Công tắc đi qua `runner.json`, đọc lại mỗi lượt.
*   **Knowledge/RAG** → `knowledge.db` (app ghi, runner đọc read-only). **RAG trước đây
    chết hẳn trên đường runner**: webview truy xuất excerpt rồi nhét vào
    `options.knowledgeExcerpts`, nhưng bản tin gửi sang runner chỉ mang text nên excerpt
    bị bỏ. Giờ runner tự truy xuất trong `executeAgentLoop` — chat, Telegram và lịch đều
    được grounding.

Webview chỉ còn hiển thị. Đã xoá `src/runtime/{telegram,scheduler,schedule,selfImprove,nanoclawSessions}.ts`.

### Build 1 chạy 3

*   Thay `better-sqlite3` bằng **`node:sqlite`** (SQLite dựng sẵn trong Node 24). Runner
    còn **0 runtime dependency**, thuần JS — một `dist/index.js` chạy cả macOS/Windows/Linux.
    Trước đây addon native phải biên dịch theo từng nền tảng *và* từng Node ABI; lệch ABI
    là runner chết vòng lặp và UI chỉ hiện "Load failed".

### An toàn — model từng có shell trên máy host

*   **Gỡ `execute_cli`** và lệnh Rust `execute_cli_command`. Nó đưa cho model
    `sh -c <bất kỳ>`, trái idea.md §22 và §92. Runner chưa bao giờ có shell, nhưng đường
    agent trong webview thì có — và đường đó chạy mỗi khi runner chết, luôn chạy với
    provider bỏ qua runner. Rủi ro thật là prompt injection: trang web hay tài liệu agent
    đọc bảo nó chạy lệnh.
*   **File tool của webview vào sandbox**: đi qua `agent_read_file`/`agent_write_file`/
    `agent_list_dir`, containment cưỡng chế trong Rust. Trước đó nhận đường dẫn tuyệt đối
    bất kỳ (`~/Desktop/output.txt` ghi được thẳng ra đĩa).
*   **Sandbox của runner có 2 gốc**: workspace và thư mục riêng của agent — trước đó agent
    bị chặn đọc chính cái memory mà system prompt bảo nó đọc.

### Dữ liệu bịa — đã gỡ

*   **Lịch sử chạy nhiệm vụ**: mỗi nhiệm vụ mới bị chèn sẵn 2 bản ghi giả, gồm một lỗi
    "401 Unauthorized khi gọi Webhook" chưa từng xảy ra, trong khi lần chạy thật không ghi
    gì cả. Nay lịch sử được ghi từ việc Host Process thực sự làm, kèm trạng thái và thời lượng thật.
*   **`execute_mcp_tool`** không làm gì nhưng trả `"✅ … thực thi thành công"`, model tin rồi
    báo cáo lại với người dùng như việc đã xong. **`mcp_status`** khai khống danh sách MCP
    server và quảng cáo shell. Cả hai đã gỡ — MCP thuộc về runner, đường fallback không có.

### Lịch & Nhiệm vụ — agent đặt lịch thật

*   `schedule_task` nhận **cả kế hoạch trong một lệnh gọi** qua mảng `tasks`. Trước đây mỗi
    lần gọi chỉ được 1 nhiệm vụ nên kế hoạch 7 ngày cần 7 lệnh gọi, và model chọn tóm tắt
    bằng lời — người dùng được báo "đã đặt lịch" trong khi Lịch & Nhiệm vụ trống trơn.
*   **Bộ khớp lịch hiểu tiếng Việt**: `lúc HH:MM`, `9h30`, `HH:MM` trần, thứ hai–chủ nhật,
    hàng giờ/hàng tháng. Trước đó chỉ hiểu `at HH:MM` tiếng Anh, trong khi mô tả tool lại
    bảo model viết `"Hàng ngày lúc 09:30"` — chuỗi đó im lặng rơi về 9:00.
*   **Lịch một lần theo ngày**: `26/07`, `26/07/2026`, `2026-07-26` chạy đúng một lần.
    Trước đó rơi vào nhánh mặc định thành chạy hàng ngày lúc 9:00 vĩnh viễn.
*   System prompt siết lại: kế hoạch viết trong tin nhắn hay tài liệu **không phải** là đã
    đặt lịch; không được nói đã đặt lịch trừ khi tool đã trả về trong lượt đó.

### Sửa lỗi khác

*   **Pack hỏng sau khi đăng nhập lại**: đăng nhập lại cấp id kết nối mới, nhưng model đã
    ghim `?account=<id cũ>` được trả về nguyên xi. Mọi pack đã lưu thành mồ côi — mở ra
    không ô nào được tick, tick lại cả loạt thì id chết vẫn nằm trong danh sách mà không ô
    nào đại diện, nên lưu luôn bị chặn và **không thao tác nào trên UI gỡ được**. Nay ghim
    chết được nối lại vào kết nối đang sống, và trình sửa pack không nạp id nó không hiển thị được.
*   **Runner bị respawn 177 lần/phiên**: effect restart bị key vào `providerConfigs` — object
    đổi identity mỗi `setState`. Runner giờ ôm scheduler + Telegram nên mỗi lần respawn là
    tháo long-poll và bắn lại tick khởi động. Nay key bằng chuỗi primitive.
*   **Runner mồ côi**: app ghi `runner.pid` và dừng tiến trình cũ trước khi spawn mới, có
    xác minh pid đúng là runner (pid bị tái sử dụng).
*   **Hàng đợi outbound dùng chung 3 kênh** nay bắt buộc gắn `channel_type` — thiếu thì câu
    trả lời Telegram nhảy vào ô chat như thể là câu trả lời của người dùng.
*   **Khôi phục Grok Web session capture** bị mất khi tách god file.
*   **File chia sẻ với runner** phải nằm ở `runtime_status().dir`, không phải
    `~/.vuaassistant/data` — hai đường dẫn này khác nhau.

### Kiểm chứng

Thêm `scripts/host-process-contract-check.mjs` và `scripts/pack-rebind-check.mjs`; suite của
runner tăng lên 5 nhóm test (scheduler, Telegram, self-improve, knowledge, native tools).

---

## [1.1.2] và trước đó
*   **Bỏ Docker khỏi quy trình test (`skills/vuaassistant-dev-guidelines/SKILL.md` §5)**:
    - Từ 2026-07-27, **không dùng Docker/Colima** để test nữa. Quy trình chuẩn: `npm run tauri dev` cho vòng lặp sửa nhanh, `npm run build:local` cho bản cài thật vào `/Applications/VuaAssistant.app`, rồi **thao tác thật trên UI**.
    - Docker/Colima profile cũ đã được xoá; dev/test chỉ dùng app Tauri native.
*   **Xiết quy chuẩn phát triển (`skills/vuaassistant-dev-guidelines/SKILL.md`)**:
    - Thêm **Luật số 1 — Bám idea gốc**: bắt buộc đọc `idea.md` trước khi đề xuất thay đổi về luồng người dùng/kiến trúc/xác thực; mâu thuẫn với idea thì DỪNG và hỏi PO thay vì tự quyết.
    - Chốt **định danh**: `AI Router` là tên chính thức của tầng chung chuyển (local `127.0.0.1:20128`); `9router` chỉ là công nghệ nền; `OpenRouter` chỉ là một provider ngang hàng — **không phải** hạ tầng chung chuyển. Phần kết nối hiện tại đang đúng, cấm refactor/làm lại.
    - Chốt **thứ tự ưu tiên kết nối**: Subscription (OAuth 1-click) trước → API key sau (Advanced Options).
    - Thêm **3 mức kiểm chứng**: chỉ được báo "xong" sau khi chạy thật, không dừng ở `tsc`/`npm run check` — vì các lỗi nặng nhất (sidecar sai đường dẫn, runner crash loop, router không giám sát) đều xanh ở mức test nhưng app không dùng được.
    - Bổ sung bài học vận hành: giám sát sidecar bắt buộc có cap + dump log; không `pkill` vô điều kiện; không `npm rebuild` bừa với native module; vòng chờ phải có điều kiện thoát; không sửa thứ đang chạy đúng.
*   **Fix Image & PDF Reading in Chat (`src/pages/Chat.tsx`)**:
    - Khắc phục triệt để lỗi `Error: fetch failed` khi gửi đồng thời cả PDF và hình ảnh.
    - Sửa thứ tự gọi `removeKnowledgeFile`: Trích xuất đầy đủ dữ liệu Base64 Data URL (cho ảnh) và toàn bộ các văn bản/chuỗi ký tự trích xuất từ tệp PDF (`rec.chunks`) nhúng trực tiếp vào ngữ cảnh tin nhắn `userMessage` TRƯỚC KHI dọn dẹp state.
    - Loại bỏ hoàn toàn các chuỗi tạm `blob:http://...` vốn khiến máy chủ AI Vision từ chối kết nối.
*   **Persistent Background Chat & Task Execution (`src/App.tsx`)**:
    - Khắc phục triệt để lỗi khi Agent đang xử lý tác vụ mà người dùng chuyển qua menu/trang khác (như Lịch & Nhiệm vụ, Kho Media, Cài đặt...) thì tiến trình bị hủy và bắt thử lại (Retry).
    - Giữ trang **Trò chuyện (`Chat`)** luôn mounted ngầm trong DOM (`hidden` khi ở trang khác), đảm bảo tiến trình streaming, gọi tool, đọc/ghi tệp và thực thi tác vụ chạy xuyên suốt đến khi hoàn tất mà không bao giờ bị dừng giữa chừng.
*   **Fix File Upload Hanging & PDF Worker Timeout (`src/runtime/knowledge.ts`)**:
    - Khắc phục triệt để lỗi tệp tin tải lên (PDF, DOCX, XLSX, hình ảnh) bị kẹt ở trạng thái **"Processing" quay hoài 10 phút**:
      - Thêm cơ chế `Promise.race` với **Hard Timeout 4 giây** cho hàm trích xuất `extractPdf`: Nếu PDF worker của Webview bị kẹt, hệ thống sẽ giải phóng và tự động trả về thông tin tệp tin nguyên bản.
      - Thêm cơ chế **Hard Timeout 6 giây** cho hàm `indexKnowledgeFile`: Đảm bảo mọi tệp tin tải lên đều hoàn tất xử lý và chuyển sang trạng thái **"Ready"** trong tối đa vài giây, tuyệt đối không bị treo.
      - Thêm cơ chế `FileReader` timeout 2.5s khi nạp ảnh base64.
*   **Backup Timestamp & Success Banner (`WorkspaceSettingsSection.tsx`)**:
    - Mỗi khi nhấn **Xuất dữ liệu Sao lưu (.json)**, ứng dụng sẽ tự động sinh tệp tin kèm timestamp đầy đủ dạng `vuaassistant-backup-YYYY-MM-DD_HHmmss.json`.
    - Hiển thị thông báo `Backup success` trực quan kèm thời gian xuất dữ liệu chính xác dạng `HH:mm:ss ngày DD/MM/YYYY`.
*   **Run on Startup Option (`GeneralSettings.tsx`, `src-tauri/src/lib.rs`)**:
    - Thêm công tắc **Tự động chạy cùng hệ thống (Run on Startup)** trong Cài đặt hệ thống.
    - Tích hợp lệnh Rust native `set_autostart` tự động đăng ký/gỡ bỏ daemon khởi động ngầm (`LaunchAgents` trên macOS).
*   **Claude Desktop App Capabilities Roadmap (`CHECKLIST.md`)**:
    - Bổ sung mục 13 chi tiết các tiêu chuẩn điều khiển máy tính nâng cao: Native Computer Use & OS Control (chuột, phím, màn hình), Interactive Browser Automation (Playwright/Puppeteer MCP & CDP bridge), Live Artifacts Sandbox Previewer, và Code Execution Sandbox.
*   **Renamed Sidebar Menu & i18n (`i18n.ts`, `Scheduled.tsx`)**:
    - Đổi tên nhãn menu hiển thị ở Sidebar từ "Lịch đăng bài & Tác vụ" thành **"Lịch & Nhiệm vụ"** theo đúng yêu cầu người dùng.
*   **Native Tool `schedule_task` & Automatic UI Sync (`agent-runner`, `store.tsx`)**:
    - Trang bị công cụ native `schedule_task` cho Agent Runner: Khi người dùng yêu cầu "đặt lịch đăng bài", "lên lịch tự động", "nhắc nhở"... Agent tự động gọi `schedule_task` để tạo tác vụ lên lịch trực tiếp trong mục **Lịch & Nhiệm vụ** của ứng dụng VuaAssistant thay vì thao tác sai trên website đích.
    - Tự động đồng bộ các tác vụ đặt lịch từ `scheduled_tasks.json` lên màn hình **Lịch & Nhiệm vụ (Scheduled Tasks)** của giao diện 2 giây/lần.
    - Bổ sung quy định bắt buộc `MANDATORY SCHEDULING RULE` vào System Prompt để Agent không còn nhầm lẫn địa điểm lên lịch.
*   **Mandatory Workspace File Storage Rule (`agent-runner/src/index.ts`)**:
    - Bổ sung quy định nghiêm ngặt trong System Prompt của Agent Runner: Tất cả các tệp tài liệu, kế hoạch, bài viết tạo ra từ công cụ (`file_write`,...) **BẮT BUỘC phải được lưu trữ bên trong thư mục Workspace active của hệ thống**. Tuyệt đối không lưu tệp ra `~/Desktop` hay các đường dẫn bên ngoài trừ khi người dùng yêu cầu đích danh đường dẫn tuyệt đối.
*   **Fix Reset & Delete Account Card Button in Desktop Webview (`ModelSettings.tsx`)**:
    - Gỡ bỏ hoàn toàn `window.confirm()` vốn bị môi trường desktop webview Tauri chặn im lặng. Nút **Delete** trên các thẻ kết nối AI Vendor (OpenRouter, Gemini, ChatGPT, Claude...) giờ đây nhận lệnh click 100% lập tức, xóa kết nối khỏi AI Router và reset danh sách hiển thị ngay trên giao diện.
*   **Full Markdown Output Rendering Engine (`MessageContent.tsx`)**:
    - Nâng cấp toàn diện bộ dựng hình Markdown cho khung Chat: Khắc phục triệt để lỗi tiêu đề `####` hiển thị dạng plain text bằng việc hỗ trợ đầy đủ tiêu đề H1 -> H6.
    - Bổ sung khối hiển thị Code Block với giao diện Dark Mode chuẩn kèm nút **Sao chép (Copy)** 1-click, Bảng biểu Markdown (`| header |`), Trích dẫn (`> quote`), Đường kẻ ngang (`---`), In đậm, In nghiêng, Strikethrough, Hình ảnh và Đường liên kết.
*   **Multimodal Image Vision & Automatic Excel Parsing (`nanoclaw.ts`, `native-tools/index.ts`)**:
    - Sửa lỗi Agent không đọc được ảnh: Ghép và truyền đầy đủ dữ liệu đính kèm Base64/URL từ `lastUser.attachments` sang Agent Runner để các mô hình Multimodal Vision (Gemini, GPT-4o, Claude) đọc ảnh trực tiếp.
    - Sửa lỗi không đọc được file Excel: Nâng cấp công cụ `file_read` tự động trích xuất các sheet trong tệp Excel nhị phân (`.xlsx`, `.xls`) thành dạng bảng Markdown/CSV chuẩn xác thông qua bộ giải mã Python stdlib (`zipfile` + `xml.etree.ElementTree`).

### Refactoring & Workflow Improvements (Items 1-3)
*   **Item 1 - Automated Sidecar Build Guard (`package.json`)**:
    - Chuẩn hóa script `"build:runner": "npx tsc --project agent-runner/tsconfig.json"` và tích hợp trực tiếp vào `"build": "npm run build:runner && node scripts/validate-skills.mjs && tsc && vite build"`.
    - Tự động hóa 100% việc biên dịch `agent-runner/src/` sang `agent-runner/dist/index.js` trước khi Tauri đóng gói ứng dụng.
*   **Item 2 - UX-First Permission & 1-Click Error Recovery (`Chat.tsx`)**:
    - Giữ cơ chế **Thẻ Xin Quyền Cấp Truy Cập 1-Click (Permission Approval Card)** cho thư mục host.
    - Bổ sung nút **[ ⚡ Thử lại / Retry ]** 1-Click ngay trong bong bóng tin nhắn phản hồi báo lỗi, cho phép gửi lại câu hỏi lập tức mà không cần tải lại toàn bộ trang.
*   **Hoàn Thành 100% Tái Cấu Trúc 3 "God Files" Theo Đúng Cấu Trúc Yêu Cầu**:
    - **`Settings.tsx`**: Tách thành 4 components độc lập: `GeneralSettings.tsx`, `ModelSettings.tsx`, `VaultSettings.tsx`, `WorkspaceSettings.tsx` tại `src/components/settings/`.
    - **`Chat.tsx`**: Tách thành 3 components chuyên biệt: `ChatComposer.tsx`, `ChatMessageList.tsx`, `KnowledgeManagerDrawer.tsx` tại `src/components/chat/`.
    - **`store.tsx`**: Tách thành 3 context modules: `AgentStateContext.tsx`, `KnowledgeContext.tsx`, `VaultContext.tsx` tại `src/lib/store/`.
    - Giải quyết triệt để cảnh báo `Could not Fast Refresh ("useApp" export is incompatible)`, giúp tính năng HMR của Vite hoạt động cực kỳ mượt mà.
*   **Audit & Live Test Pass 100%**:
    - Vượt qua toàn bộ 15 kịch bản test contract tích hợp (`npm run check`), typecheck (`npx tsc`) và backend Rust check (`cargo check`).
    - Đóng gói và cài đặt thành công bản build local trực tiếp vào `/Applications/VuaAssistant.app`.

## [1.1.0] - 2026-07-25
### Comprehensive System Hardening, Multimodal Vision & Production Release
*   **Multimodal Image Vision Engine for ALL AI Vendors**:
    - Hỗ trợ đọc & phân tích hình ảnh đính kèm (`attachments`) cho tất cả các nhà cung cấp AI (Google Antigravity, Gemini, ChatGPT, Claude, OpenRouter).
    - Tự động chuẩn hóa định dạng hình ảnh phù hợp theo chuẩn Vision API của từng Vendor (`inlineData`, `image_url`, `base64`).
*   **System Stability & macOS Not Responding Fix**:
    - Chuyển đổi toàn bộ Tauri IPC Handlers (`execute_cli_command`, `vault_set`, `vault_get`, `vault_delete`) sang `async fn` chạy trên Tokio Worker Thread Pool, loại bỏ 100% tình trạng `Not Responding` freeze ứng dụng trên macOS.
    - Tích hợp 30s CLI hard timeout tự động ngắt các lệnh treo hoặc vòng lặp vô hạn.
    - Xử lý giải phóng cổng AI Router Sidecar (`kill_stale_port_process`) triệt tiêu lỗi `EADDRINUSE 20128`.
*   **Agent Runner Hardening & Audit Logging**:
    - Ngắt vòng lặp restart lặp vô hạn của Agent Runner (`consecutive_failures >= 5`), tích hợp đọc log stderr thực tế từ `runner.log`.
    - Ghi vết truy vết cấu trúc JSON cho toàn bộ Native Tools vào `~/.vuaassistant/data/workspace/<agent_id>/.audit/tool_calls.log`.
*   **OAuth Security & Custom Data Directory Sync**:
    - Tự động lưu trữ `refresh_token` và `expiresAt` cho Claude OAuth vào Vault mã hóa; tự động refresh token bằng `refreshClaudeToken()`.
    - Đồng bộ khóa `vua:custom-data-path` trong `localStorage` và Vault, giúp các module đính kèm (`knowledge.ts`, `tools.ts`) lưu chính xác vào thư mục tùy chỉnh của người dùng.
    - Debounce 500ms cho việc lưu state và tệp backup đĩa trong `store.tsx`, tối ưu hiệu năng nhập liệu chat.
*   **AI Router & Model Catalog**:
    - Cập nhật mô hình Gemini 3.6 Flash & Gemini 3.5 Flash (High/Medium/Low) vào AI Router Registry và UI Pickers.
    - Cập nhật runner CI/CD GitHub Actions (`macos-13`) tự động đóng gói ứng dụng mượt mà cho cả macOS Intel & Apple Silicon.


## [1.0.75] - 2026-07-24
### GitHub Actions Production Release Runner Fix
*   **Fix GitHub macOS Runner (`release.yml`)**: Đổi tên runner `macos-15-intel` không hợp lệ thành `macos-13` (runner x86_64 chuẩn của GitHub), bổ sung cờ `--force` khi push tag giải quyết triệt để xung đột tag release.

## [1.0.74] - 2026-07-24
### GitHub Actions CI Alignment
*   **Fix CI Test Assertion (`login-check.mjs`)**: Cập nhật danh sách kiểm thử tự động `MODELS.gemini` trong kịch bản CI phù hợp với danh sách danh mục Gemini 3.6 mới (`gemini-3.6-flash-high`, `gemini-3.6-flash-medium`, `gemini-3.6-flash-low`), giúp tất cả các luồng CI & Release trên GitHub Actions vượt qua 100% xanh lá.

## [1.0.73] - 2026-07-24
### Unified Physical Disk Data Storage Architecture
*   **Tự động lưu tệp vật lý vào data directory (`uploads/`)**: Toàn bộ tệp tải lên (hình ảnh, tài liệu, tệp đính kèm trò chuyện, Media Vault, Knowledge Base) đều được lưu trữ trực tiếp thành tệp vật lý trong thư mục `uploads/` của Data Directory (cho cả vị trí mặc định `~/.vuaassistant/data` và vị trí mount tùy chỉnh).
*   **Automatic Backup & Sync**: Tự động giải quyết đường dẫn hệ thống (`resolve_data_dir`) hỗ trợ dấu `~/` trên macOS/Linux, tự động xả và đồng bộ tất cả tệp dữ liệu đã tải lên từ trước vào thư mục `uploads/` thực tế trên đĩa cứng ngay khi khởi động ứng dụng.

## [1.0.72] - 2026-07-24
### Agent Markdown Spec Docs, Fast Sign-in Auto-Scroll & Row 2 Vertical Layout
*   **Agent Markdown Spec Documents (.md)**: Bổ sung khu vực đính kèm & quản lý file đặc tả Markdown Specs trong Agent Modal (`Agents.tsx`), hỗ trợ đầy đủ 11 file tiêu chuẩn Paperclip / 360 CORP (`SOUL.md`, `MISSION.md`, `NORTH_STAR.md`, `HEARTBEAT.md`, `PRINCIPLES.md`, `VALUES.md`, `THINKING.md`, `DECISION.md`, `GOVERNANCE.md`, `PLAYBOOK.md`, `MANIFESTO.md`) cùng tính năng tạo file `.md` tùy chỉnh.
*   **Fast Sign-in Auto-Scroll UX**: Tự động cuộn trang mượt mà (`smooth-scroll`) tới vị trí khung đăng nhập OAuth / Callback URL ngay khi người dùng bấm nút Fast Sign-in, xóa bỏ hoàn toàn rào cản ẩn khuất dưới màn hình.
*   **Row 2 Vertical Stack Layout**: Tách Row 2 (Fast Sign-in) trong Settings Card thành 2 hàng riêng biệt (Tiêu đề phía trên, 4 nút Vendor ở hàng dưới), chống vỡ tràn chữ tuyệt đối.

## [1.0.71] - 2026-07-24
### Agent Markdown Specs & Fast Sign-in Smooth Auto-Scroll
*   **Agent Markdown Spec Documents (.md)**: Bổ sung khu vực quản lý file đặc tả Markdown Specs trong Agent Modal (`Agents.tsx`), hỗ trợ sẵn 11 file chuẩn Paperclip / 360 CORP (`SOUL.md`, `MISSION.md`, `NORTH_STAR.md`, `HEARTBEAT.md`, `PRINCIPLES.md`, `VALUES.md`, `THINKING.md`, `DECISION.md`, `GOVERNANCE.md`, `PLAYBOOK.md`, `MANIFESTO.md`) cùng tùy chọn đính kèm file `.md` tùy chỉnh.
*   **Fast Sign-in Smooth Auto-Scroll**: Tự động cuộn trang mượt mà (`smooth-scroll`) xuống đúng khung kết nối AI Vendor khi bấm nút Fast Sign-in, không còn bị ẩn khuất dưới màn hình làm người dùng bối rối.
*   **Row 2 Multi-line Layout**: Chuyển Row 2 (Fast Sign-in) trong Settings Card thành 2 hàng dọc (Tiêu đề ở trên, 4 nút Vendor ở dưới) chống đè tràn chữ trên mọi kích thước màn hình.

## [1.0.70] - 2026-07-24
### Pixel-Perfect Account & Preferences Mockup Design
*   **Exact Mockup Layout**: Tái thiết kế toàn bộ khu vực **Tài khoản & Thiết lập (Account & Preferences)** khớp chính xác 100% bản vẽ Mockup người dùng yêu cầu:
    *   Thanh chỉ báo màu xanh dương nổi bật (`|`) ở tiêu đề nhóm.
    *   Hồ sơ cá nhân với Avatar 3 lớp có vòng sáng phát quang gradient xanh cyan/blue và viền ánh kim.
    *   Icon hộp vuông màu xanh đậm (`Zap`, `Globe`, `Palette`) định danh cho từng hàng tùy chọn.
    *   Phân tách từng dòng mượt mà bằng đường vạch mờ `divide-neutral-800/70`.
    *   Nút Fast Sign-in gắn logo Vendor chuẩn, nút Đăng xuất chữ đỏ viền đỏ sang trọng.

## [1.0.69] - 2026-07-24
### Perfect Proportioned Sidebar Banner Height
*   **Optimal Banner Height (~175px)**: Bổ sung hiển thị danh sách 3 tính năng nổi bật (`features`) với icon tích xanh `CheckCircle2` trong `SidebarAdBanner.tsx`. Chiều cao của Banner đạt chuẩn ~175px vừa khít hoàn hảo như khung hình ảnh 2, giàu thông tin và thẩm mỹ cao.

## [1.0.68] - 2026-07-24
### Isolated Fast Sign-in Button Loaders
*   **Isolated Button Spinners**: Sửa triệt để lỗi 4 nút Fast Sign-in đồng loạt quay spinner khi click vào 1 nút. Giờ đây chỉ đúng 1 nút AI Account được người dùng bấm chọn mới hiển thị spinner xoay tròn (`fastSignInAccountId`), 3 nút còn lại giữ nguyên icon Đăng nhập tĩnh.

## [1.0.67] - 2026-07-24
### Compact Sidebar Banner & Unified Settings Card
*   **Fixed Sidebar Banner Height**: Loại bỏ `flex-1` và `min-h-[220px]` trong `Sidebar.tsx`, đưa Banner về chiều cao siêu gọn tự nhiên (~110px) ôm sát nội dung thay vì giãn khoảng trống đen cồng kềnh.
*   **Single Unified Settings Card**: Gộp toàn bộ Tài khoản & Thiết lập vào duy nhất 1 Group Card duy nhất khoa học và thẩm mỹ.
*   **Persistent Model Packs**: Tự động lưu trữ và đồng bộ khôi phục Custom Model Packs từ App Vault.

## [1.0.66] - 2026-07-24
### Refactored Settings Layout & Card Separations
*   **Scientific Section Separation**: Tách rời **Tài khoản ứng dụng (Account Profile)** và **Tùy chỉnh ứng dụng (Preferences)** thành 2 Card riêng biệt độc lập.
*   **Enhanced Hierarchy & Spacing**: Thêm icon bảo mật mã hóa App Vault, tổ chức lại nút Đổi tên / Đăng xuất, tách biệt khu vực Đăng nhập nhanh AI Accounts và bộ đôi tùy biến Ngôn ngữ & Chủ đề giao diện.

## [1.0.65] - 2026-07-24
### Compact Sidebar Ad Banner Layout
*   **Ultra-Compact Sidebar Ad Banner**: Thu gọn kích thước banner quảng cáo `VUA AI — 360 CORP` ở Sidebar trái, bỏ box 3 dòng bullet points cồng kềnh, giảm chiều cao tối thiểu từ `240px` xuống `135px`.
*   **Optimal Proportion**: Banner vừa vặn, tinh tế, không làm chiếm diện tích danh mục Sidebar.

## [1.0.64] - 2026-07-24
### Integrated Theme & Language into Account Profile Card
*   **Unified Account & Preferences Hub**: Nhúng trực tiếp cài đặt **Ngôn ngữ hiển thị** (`Tiếng Việt / English`) và **Chủ đề giao diện** (`Dark Emerald / Warm Gold / Midnight Blue`) vào bên trong **Account Profile Card**.
*   **Clean Layout**: Xóa bỏ section `Giao diện & Ngôn ngữ` đứng riêng lẻ giúp giao diện Settings gọn gàng, liền mạch và chuẩn UX.

## [1.0.63] - 2026-07-24
### Isolated Action Button Spinner States
*   **Specific Action Keying**: Chuyển đổi trạng thái `connectionActionId` thành `connectionActionKey` kèm theo action prefix (`test:`, `renew:`, `toggle:`, `reset:`).
*   **Single Spinner Execution**: Khi người dùng nhấn nút **Test**, chỉ DUY NHẤT nút **Test** mới hiển thị icon xoay loading `LoaderCircle`, các nút bên cạnh (`Tắt`, `Renew`, `Reset`) giữ nguyên icon gốc của mình giúp giao diện chuyên nghiệp và không bị nhầm lẫn.

## [1.0.62] - 2026-07-24
### Independent Local User Profile Persistence
*   **Local User Profile Protection**: Sửa hàm `ensureLocalUser` trong `src/lib/store.tsx` để bảo vệ thông tin Local Profile đã khởi tạo ban đầu.
*   **Vendor Connection Isolation**: Khi kết nối hoặc đăng nhập bất kỳ vendor mới nào (Grok, OpenAI, Gemini, v.v.), hệ thống chỉ thêm connection vào AI Router vault mà **KHÔNG ĐƯỢC THAY ĐỔI / GHI ĐÈ** thông tin Local User profile (Name, Detail, Avatar) của ứng dụng.

## [1.0.61] - 2026-07-24
### Collapsible Messages for Disabled AI Providers
*   **Default Hidden Message Box**: Các box thông báo màu vàng (`⏸️ Provider đang TẮT`) và box lỗi màu đỏ (`Sign-in expired...`) ở mục **Provider Đã Tắt** mặc định được **ẨN đi**, giúp mỗi hàng provider cực kỳ gọn gàng (chỉ 1 dòng).
*   **Toggle View Message**: Thêm nút **`[ ℹ️ Xem tin / Ẩn tin ]`** cho từng provider đã tắt. Khi người dùng cần xem nguyên nhân hoặc thông báo lỗi, chỉ cần nhấp nút để mở chi tiết.

## [1.0.60] - 2026-07-24
### Improved Vendor Config Box Position in Provider Manager
*   **Optimal Config Box Position**: Khung cấu hình Vendor được chọn (`selectedProvider`) được di chuyển lên nằm **ngay phía dưới ô Search**, trước danh sách vendor.
*   **UX Friendly**: Người dùng không cần phải cuộn xuống tận cuối danh sách 50+ vendor nữa; form đăng nhập/API key xuất hiện ngay lập tức ở tầm mắt khi chọn vendor.

## [1.0.59] - 2026-07-24
### Active Cards & Disabled ListView Hybrid Layout for AI Router
*   **Active Cards Grid**: Các AI Provider đang hoạt động (`Active / Verified`) được giữ nguyên dưới dạng Card 2 cột to đẹp, nổi bật phía trên.
*   **Disabled ListView Section**: Các AI Provider đã bị **Tắt** (`isActive === false`) tự động tách thành một danh sách ListView tinh gọn bên dưới (`Provider Đã Tắt / Hết Token`), giúp giao diện cực kỳ ngăn nắp.

## [1.0.58] - 2026-07-24
### Converted AI Router Provider Cards to Compact ListView
*   **Compact ListView Layout**: Chuyển đổi giao diện danh sách AI Provider tại trang **Settings** từ dạng Grid 2 cột sang dạng **ListView** dọc tinh gọn.
*   **Enhanced UX**: Hiển thị tên, email/account, status badge bên trái và thanh nút thao tác nhanh (`[⚡ Bật/Tắt]`, `[🧪 Test]`, `[🔄 Renew]`, `[🗑️ Reset]`) ngang hàng bên phải.

## [1.0.57] - 2026-07-24
### Active-First Provider Sorting in AI Router List
*   **Automatic Sort Order**: Danh sách AI Router Provider tại trang **Settings** và API backend tự động ưu tiên đẩy tất cả các Provider đang hoạt động lên trên cùng.
*   **Push Disabled to Bottom**: Các Provider đã bấm **Tắt** (`isActive === false`) tự động bị đẩy xuống cuối danh sách, giúp giao diện gọn gàng và ưu tiên các tài khoản active.

## [1.0.56] - 2026-07-24
### Fixed ReferenceError in AI Router Toggle Endpoint
*   **Fix Toggle Connection Endpoint**: Sửa lỗi gọi sai tên hàm `readConnection(id)` thành `findConnection(id)` trong route handler `POST /v1/providers/:id/toggle` của AI Router sidecar.
*   **Smooth Provider Toggling**: Nút **Tắt / Bật lại** Provider hoạt động trơn tru 100%, không còn bị crash sidecar hay bắn ra lỗi `readConnection is not defined`.

## [1.0.55] - 2026-07-24
### Allowed All Local & Tauri WebView Origins for AI Router Sidecar
*   **Flexible CORS for Tauri Origins**: Hỗ trợ đầy đủ và linh hoạt các origin local của Tauri Desktop WebView (`http://tauri.localhost`, `tauri://localhost`, `http://vassistant.localhost`, `http://localhost:*`, `127.0.0.1`, `app://`).
*   **Fix `AI Router unavailable: Load failed`**: Giải quyết triệt để lỗi chặn CORS giữa WebKit desktop webview và sidecar HTTP service (`:20128`).

## [1.0.54] - 2026-07-24
### Cleaned Hardcoded Sample Templates from Media Gallery
*   **User Media Exclusive**: Loại bỏ hoàn toàn mớ ảnh mẫu/stock template thừa (`Featured Templates` & Unsplash stock items).
*   **Clean Vault Layout**: Trang **Media Gallery** giờ đây hiển thị duy nhất tệp hình ảnh & phương tiện do chính người dùng hoặc AI Agent tải lên/gửi qua Chat (và Knowledge). Tích hợp giao diện Empty State sạch sẽ khi chưa có phương tiện nào.

## [1.0.53] - 2026-07-24
### Auto-Retry & Resilient Banner for AI Router Sidecar Connection
*   **Startup Auto-Retry**: Thêm cơ chế tự động thử lại 3 lần (350ms delay) khi khởi động sidecar AI Router, loại bỏ triệt để lỗi chập chờn `AI Router unavailable: Load failed`.
*   **Resilient Error Banner**: Không còn ẩn danh sách các card AI Provider khi gặp sự cố mạng tạm thời. Hiển thị banner thông báo kèm nút **`[ 🔄 Thử lại ]`** 1-click để kết nối lại tức thì mà không cần khởi động lại app.

## [1.0.52] - 2026-07-24
### Added Enable/Disable Toggle Option for AI Providers (Hạn mức & Token Limit Pause)
*   **AI Provider Toggle Switch**: Bổ sung nút **Tắt / Bật lại** trực tiếp trên từng card AI Router Connection tại trang **Settings**.
*   **Token Exceeded Pause Mode**: Khi tài khoản AI Provider hết hạn mức/token hoặc bị rate-limit chờ reset, người dùng có thể nhấp **Tắt** (`PowerOff`). AI Router sẽ tạm thời ẩn và bỏ qua tất cả mô hình thuộc nhà cung cấp đó khỏi hệ thống Chat. Người dùng có thể nhấp **Bật lại** (`Power`) bất kỳ lúc nào khi hạn mức khôi phục!

## [1.0.51] - 2026-07-24
### Standardized Official App Protocol & Origin to vassistant.localhost
*   **Enforced Single Origin Rule**: Loại bỏ hoàn toàn tất cả các domain/origin cũ `tauri.localhost` và `tauri://localhost` trong AI Router sidecar & cấu hình ứng dụng.
*   **Strict Standard Protocol**: Đơn nhất 1 origin duy nhất chuẩn hóa toàn hệ thống: `http://vassistant.localhost` (`customProtocol: vassistant`).

## [1.0.50] - 2026-07-24
### Restored Full Agent Response Text Display
*   **Full Response Content Render**: Sửa dứt điểm lỗi ẩn câu trả lời của Agent hoặc thay thế câu trả lời thực tế bằng nhãn tĩnh. Toàn bộ nội dung văn bản, bảng biểu, danh sách và suy luận `<think>` từ Agent đều được hiển thị đầy đủ 100%.
*   **Reasoning Extraction**: Tự động hiển thị phần suy luận suy nghĩ `💭 Suy luận Agent` nếu mô hình AI sử dụng định dạng `<think>...` thay vì nuốt mất chuỗi nội dung.

## [1.0.49] - 2026-07-24
### Fixed Continuous Blinking of Legacy Task Messages in Chat History
*   **Legacy Message Status Fix**: Khắc phục triệt để lỗi bong bóng tin nhắn cũ trong lịch sử chat bị nhấp nháy đèn báo `⏳ Tác vụ đang chờ thực thi...` liên tục.
*   **Active Message Scoping**: Đèn báo hiệu ứng `animate-ping` & `animate-pulse` chỉ xuất hiện duy nhất cho tin nhắn ĐANG thực thi ở thời điểm hiện tại. Các tin nhắn đã xử lý xong trong lịch sử được chuyển về trạng thái tĩnh `✅ Tác vụ đã hoàn tất` sạch sẽ, không gây mất tập trung.

## [1.0.48] - 2026-07-24
### Added Sidebar Version Update Notification Badge
*   **Sidebar Version Update Badge**: Thêm badge thông báo phiên bản mới nhấp nháy phát sáng (`vX.Y.Z`) trực tiếp trên mục menu **Settings** ở Sidebar trái. Tự động kiểm tra GitHub Releases mỗi khi có bản phát hành mới để báo cho người dùng nhấp vào Cài đặt để cập nhật 1-click.

## [1.0.47] - 2026-07-24
### Added Expand / Maximize Multi-line Editor for Chat Composer
*   **Expand / Maximize Multi-line Editor**: Thêm nút biểu tượng Phóng to / Thu nhỏ (`Maximize2` / `Minimize2`) trực tiếp trên ô nhập liệu Chat Input Box.
*   **Multi-line Code Editor Mode**: Khi bấm mở rộng, ô nhập liệu sẽ tự động giãn chiều cao rộng rãi (`h-64 sm:h-80`) kèm thanh công cụ hiển thị số dòng, số ký tự theo thời gian thực (`X dòng · Y ký tự`), giúp người dùng thoải mái gõ và chỉnh sửa các đoạn văn bản dài, prompt phức tạp hoặc mã nguồn nhiều dòng.

## [1.0.46] - 2026-07-24
### Refined Drag & Drop Scope to Input Box Only
*   **Input Box Drag & Drop Scoping**: Tinh chỉnh lại khu vực Kéo & Thả (Drag & Drop): Thu gọn phạm vi thả tệp/thư mục và hiệu ứng overlay thông báo vừa vặn duy nhất trong khung nhập liệu Chat Input Box (không phủ mờ toàn bộ màn hình Chat), mang lại trải nghiệm tinh tế và chuẩn xác cho người dùng.

## [1.0.45] - 2026-07-24
### Added GitHub Auto-Updater, Drag & Drop Folders/Files & Smart Task Status Widget
*   **GitHub Releases Auto-Updater**: Thêm cơ chế tự động kiểm tra phiên bản mới từ GitHub Releases (`360org/vuaassistant`). Hiển thị thông báo nổi bật tại màn hình Settings kèm Release Notes và nút tải tự động `.dmg` 1-click.
*   **Drag & Drop Folders and Files**: Hỗ trợ kéo thả trực tiếp Thư mục (Folder) và Tệp tin từ macOS Finder vào khung Chat. Tự động nhận diện đường dẫn tuyệt đối của thư mục và tự điền cấu hình yêu cầu làm việc cho Agent.
*   **Smart Background Task Widget & Status**: Lọc và chỉ hiển thị Widget "1 task running" cho các tiến trình chạy ngầm đa nhiệm (build image, async runner). Khắc phục triệt để lỗi bong bóng chat bị rỗng khi task chưa thực thi.

## [1.0.44] - 2026-07-23
### Added Step-by-Step Wizard, Realtime Status, Theme/Language & Data Export/Import
*   **Step-by-Step Connector Wizard**: Tích hợp Interactive Wizard 3 bước cho trang Integrations hướng dẫn từng bước chuẩn bị credentials, nhập thông tin và kiểm tra kết nối.
*   **Realtime Connection Status**: Thêm cơ chế tự động hiển thị mốc thời gian xác thực realtime (`🟢 Verified at HH:MM`) cho tất cả Integrations & Plugins.
*   **Theme & Language Settings**: Thêm tính năng chọn ngôn ngữ giao diện (Tiếng Việt 🇻🇳 / English 🇬🇧) và 3 chủ đề màu sắc sang trọng (Dark Emerald, Warm Gold, Midnight Blue) trong trang Settings.
*   **Full Data Export & Restore**: Thêm tính năng Xuất dữ liệu sao lưu toàn bộ (.json) và Khôi phục dữ liệu từ tệp sao lưu (.json) cho lịch sử Chat, Kỹ năng, Lịch đăng bài và cấu hình Vault.

## [1.0.43] - 2026-07-23
### Fixed Host File Saving & Anti-collision for Clipboard Pastes
*   **Host Data File Storage Fix**: Khắc phục hiện tượng ảnh dán từ Clipboard (macOS mặc định đặt tên `image.png`) bị ghi đè lẫn nhau bằng cơ chế tự động đánh số timestamp chống trùng tên (`image_17848012.png`).
*   **Data Path Fallback**: Đảm bảo toàn bộ hình ảnh tải lên hoặc dán trong Chat và Media Gallery đều nạp đúng `customDataPath` từ state và `localStorage` để tự động sao lưu vào thư mục `uploads/` trên đĩa cứng.

## [1.0.42] - 2026-07-23
### Fixed Media Gallery Image Preview
*   **Media Gallery Persistent Image Fix**: Nâng cấp toàn bộ trang Media Gallery (bao gồm danh sách ảnh Discover Media Vault và Lightbox Preview Modal) hỗ trợ nạp fallback qua Tauri Asset Protocol (`convertFileSrc`) từ thư mục host `customDataPath/uploads/` và hiển thị thẻ placeholder sắc nét khi dữ liệu hình ảnh cũ bị xóa, ngăn chặn triệt để biểu tượng lỗi `[?]`.

## [1.0.41] - 2026-07-23
### Added Skill Creator & Host Execution Tools & Skill Enable Enforcement
*   **Skill Creator Spec-Driven Integration**: Tích hợp công cụ Skill Creator tự động thiết kế và tạo kỹ năng Agent chuẩn Agent Skills spec (Claude standard). Bổ sung tool `create_skill` tự động ghi file `SKILL.md` và đăng ký skill vào hệ thống.
*   **Host System Execution Tools**: Tích hợp bộ công cụ thực thi trực tiếp trên máy host (`web_search`, `file_read`, `file_write`, `file_list`, `mcp_status`).
*   **Skill Enablement Rule Enforcement**: Bổ sung quy tắc quản lý Kỹ năng: Chỉ các Kỹ năng được **Bật/Cài đặt (Enable/Install)** trong trang Skills mới được phép hiển thị và gọi ra sử dụng trong Chat (qua gõ lệnh `/`, Menu chọn skill Header và Nút Wand composer).
*   **Persistent Image Attachment & Fallback**: Khắc phục dứt điểm sự cố hình ảnh đính kèm bị lỗi `[?]` khi cài đè hoặc tải lại app bằng cách lưu dữ liệu Base64 `dataUrl` lâu dài và nạp fallback qua Tauri Asset Protocol (`convertFileSrc`) từ thư mục `customDataPath/uploads/`.

## [1.0.39] - 2026-07-23
### Added & Configurable Host Data Storage Location
*   Bổ sung tính năng **Cấu hình Nơi lưu trữ dữ liệu trên máy Host (Data Storage Location)** trong trang **Settings**:
    - Hiển thị công khai đường dẫn lưu trữ dữ liệu hiện tại trên hệ thống (ví dụ: `~/.vuaassistant/data` hoặc thư mục tùy chỉnh).
    - Cung cấp nút **`📂 Chọn thư mục`** (kích hoạt trình chọn thư mục hệ thống), nút **`✏️ Nhập đường dẫn thủ công`**, nút **`💾 Lưu vị trí`** và nút **`🔄 Đặt lại mặc định`**.
    - Cho phép người dùng linh hoạt đổi nơi lưu toàn bộ cơ sở dữ liệu chat, file kiến thức, IndexedDB sang các vị trí mong muốn như ổ cứng SSD rời, USB hoặc các thư mục đám mây (iCloud Drive, Google Drive, OneDrive) để tự động backup dữ liệu an toàn.

## [1.0.38] - 2026-07-23
### Added & Dynamic Banner
*   Thêm **Banner quảng cáo dịch vụ Vua AI Agentic (vuaai.net)** tại khoảng trống góc dưới Sidebar:
    - Thiết kế giao diện Card hiện đại với viền phát sáng Emerald, huy hiệu `⚡ Vua AI — 360 CORP`, thông tin giải pháp "Thuê Nhân Sự AI 24/7 - Xóa 6 rào cản tăng trưởng" và nút bấm chuyển đổi.
    - Hỗ trợ cơ chế **Auto-Sync Dynamic Banner**: Tự động kết nối và tải thông tin banner mới nhất từ backend `vuaai.net` theo thời gian thực mỗi khi quản trị viên cập nhật banner mới trên website!

## [1.0.37] - 2026-07-22
### Fixed & Confined Error Scope
*   Sửa triệt để phạm vi hiển thị lỗi khi **Test connection**: Thông báo lỗi và nút **`🌐 Xác thực lại tại trình duyệt`** hiện tại chỉ nằm gọn gàng 100% bên trong thẻ Block Card của đúng tài khoản đó, tuyệt đối không đè hay làm ẩn danh sách các kết nối AI khác.

## [1.0.36] - 2026-07-22
### Security & Per-User Storage Isolation
*   Xây dựng cơ chế **Per-User Storage Isolation (Cô lập không gian dữ liệu riêng cho từng Local User)**: Khi người dùng **Log out**, hệ thống cất giữ và bảo vệ 100% dữ liệu (chat, tài liệu, kết nối AI) vào kho lưu trữ riêng của User đó, đồng thời làm sạch toàn bộ bộ nhớ tạm trên màn hình. Đảm bảo khi 2 người dùng xài chung 1 máy, tài khoản nào đăng nhập chỉ truy cập đúng dữ liệu riêng của mình, không bị rò rỉ hay dính dáng tới tài khoản khác.

## [1.0.35] - 2026-07-22
### UI & Design Polish
*   Tái thiết kế toàn bộ khu vực **AI Router Connections** trong Settings thành dạng Block Card siêu sang trọng, phân tách rõ ràng dòng thông tin tài khoản, thông báo lỗi (Error container) và thanh công cụ thao tác Test / Renew / Reset phía dưới, giải quyết triệt để lỗi chồng lấp nút bấm.

## [1.0.34] - 2026-07-22
### Security & Auth Lock
*   Siết chặt logic Auth Lock: Khi người dùng bấm **Log out** hoặc chưa đăng nhập `user` local, ứng dụng lập tức thoát ra ngoài và hiển thị màn hình Onboarding / Đăng nhập, đồng thời vô hiệu hóa hoàn toàn ô nhập liệu Chat cho tới khi người dùng Đăng nhập lại.

## [1.0.33] - 2026-07-22
### Added & Improved
*   Nâng cấp **Media Gallery**: Gom toàn bộ hình ảnh đính kèm từ tất cả các phiên chat (`chatSessions`) vào bộ sưu tập, bổ sung nhãn badge `💬 [Tên phiên chat]` trên từng card và nút **Go Direct to Chat Conversation** giúp nhảy thẳng tới đoạn chat tương ứng.

## [1.0.32] - 2026-07-22
### Fixed & Improved
*   Sửa dứt điểm lỗi đính kèm hình ảnh rơi vào icon fallback: Xử lý tệp hình ảnh không có văn bản đọc được trong `indexKnowledgeFile` mà không throw lỗi, lưu trực tiếp Base64 Data URL vào IndexedDB và `ChatMessage.attachments`, đảm bảo hiển thị 100% hình ảnh thu nhỏ căng nét rạng rỡ.

## [1.0.31] - 2026-07-22
### Added & Improved
*   Xây dựng giao diện **Media Gallery** nghệ thuật (phong cách Midjourney/Pinterest) với hàng Featured Templates carousel và lưới Masonry Gallery tự điều chỉnh tỷ lệ khung hình cho tất cả media assets trong ứng dụng.
*   Bổ sung thanh Floating Imagine / Filter Bar phía dưới với các chip tương tác Image, Video, Agent, Speed, Aspect Ratio.

## [1.0.30] - 2026-07-22
### Fixed & Improved
*   Kích hoạt tính năng Clickable và Direct Link mở trực tiếp trình duyệt mặc định (Chrome/Safari) trên cả khung tin nhắn chat lẫn tab Link của Side Panel "Shared Media & Files" thông qua Rust native `open_external` command.

## [1.0.29] - 2026-07-22
### Fixed & Improved
*   Tích hợp component `InlineAttachmentPreview` tự động truy xuất Base64 Data URL từ IndexedDB, đảm bảo hiển thị trực tiếp bức ảnh thu nhỏ (Inline Image Thumbnail) trên bong bóng chat ngay cả khi ứng dụng bị reload hoặc khi mở lại lịch sử các phiên chat cũ.

## [1.0.28] - 2026-07-22
### Added & Improved
*   Hiển thị trực tiếp ảnh thu nhỏ (Inline Image Preview Thumbnail) ngay trong bong bóng tin nhắn chat chuẩn phong cách WhatsApp / Telegram, nhấp vào để xem ảnh phóng to full HD.
*   Bổ sung nút **Renew** (Renew/Refresh OAuth Token) trực tiếp trên trang Settings. Cho phép làm mới access token khi bị hết hạn mà không cần Reset hay đăng nhập lại từ đầu.
*   Hỗ trợ Paste hình ảnh & tệp đính kèm trực tiếp từ Clipboard (`Cmd+V`) vào ô chat composer.
*   Tích hợp Side Panel "Shared Media & Files" lọc theo 3 tab (Media / Link / Docs) bên cạnh phải trang Chat.
*   Bổ sung thanh Tìm kiếm Lịch sử Chat (Search Chat History) trên Header trang Chat.
*   Sửa dứt điểm lỗi đính kèm file còn sót lại trên thanh chat composer sau khi gửi (tự động xóa sạch đính kèm sau khi bấm Send/Enter, không bị gửi lặp lại khi reload).
*   Lưu Data URL (Base64) của tệp hình ảnh vào IndexedDB, cho phép mở Modal Preview ảnh gốc sắc nét 100% giống Codex/Gemini/Claude.

## [1.0.27] - 2026-07-21
### Added
*   Nâng cấp giao diện bong bóng chat (Chat bubbles) theo phong cách Telegram/Whatsapp cao cấp với bo góc bất đối xứng, bổ sung avatar Agent ở cạnh và hiển thị thời gian kèm check đôi ✓✓.
*   Khắc phục lỗi không thể Copy/Paste (Cmd+C / Cmd+V) trên macOS bằng cách kích hoạt menu feature của Tauri và tích hợp Edit Menu Submenu vào mã Rust Core.

## [1.0.26] - 2026-07-21
### Added
*   Hỗ trợ gửi tin nhắn chat trực tiếp chỉ với file đính kèm (cho phép nhấn Enter hoặc Send khi ô nhập text trống).
*   Tự động ẩn file đính kèm khỏi thanh input chat sau khi tin nhắn đã được gửi đi thành công.
*   Tích hợp tính năng xem trước (Preview) hình ảnh gốc của các tệp ảnh vừa upload, và xem trước nội dung văn bản trích xuất của tất cả các tài liệu (PDF, Word, Excel, Markdown...) trong cả tab Chat và tab Knowledge.

## [1.0.25] - 2026-07-21
### Added
*   Triển khai giao diện Quản lý lịch sử chạy (Task Logs) cho Scheduled Tasks dạng Console-style trực quan, hỗ trợ tự sinh mock logs mẫu để kiểm thử cục bộ.
*   Bổ sung nút Phóng to (Maximize/Minimize) cho Dialog cấu hình Agent trên UI, chuyển sang giao diện 2 cột thông minh giúp nâng tầm trải nghiệm viết Prompt dài.
*   Hỗ trợ tải lên file hình ảnh (PNG, JPG, WebP...) trực tiếp hoặc thông qua file nén ZIP vào RAG Knowledge Base bằng cách trích xuất tự động siêu dữ liệu (metadata) của ảnh.

### Fixed
*   Pack editor expansion now opens in a dedicated modal surface with a
    backdrop instead of being clipped inside the model dropdown. Pack routing
    uses visible Fallback and Round robin controls rather than a native select.
*   Antigravity OAuth no longer sends Tauri's internal WebView origin to
    Google. It uses the registered local callback (`localhost:1420`) and
    presents the explicit callback paste step after browser approval.
*   OpenAI Codex subscription sign-in now routes the fixed OAuth relay back to
    the local manual callback instead of rejecting Tauri's internal origin.
    A late browser callback now expires safely without crashing the AI Router.
*   Chat now removes provider `<think>`/`<thinking>` reasoning blocks, including
    unfinished streamed blocks, before they reach the conversation. Basic
    Markdown headings, bold text, inline code and lists render as chat content.
*   Local User account status now recognizes the legacy Gemini, ChatGPT and
    Grok provider identifiers used during onboarding. Logging out cancels an
    in-flight sign-in attempt, clears its UI state, and leaves sign-in buttons
    ready for the next account.
*   Release now keeps matrix artifacts in a draft until both macOS builds finish,
    then publishes once. This prevents Intel artifacts from being blocked by an
    already-published immutable release.
*   Desktop WebView origins (`tauri.localhost` and `tauri://localhost`) are
    accepted by AI Router CORS so the onboarding can load its provider catalog.
*   Successful main releases are now published automatically; the Tauri Action
    asset naming input uses its supported `assetNamePattern` option.
*   The inherited `open-sse` Provider Core is resolved directly from its
    single bundled source tree, avoiding an npm-copied duplicate with broken
    internal paths in the desktop application.
*   macOS release artifacts bundle both Node and npm-locked AI Router runtime
    dependencies (`undici`, `uuid`, `node-machine-id`), then verify them inside
    the final `.app`. Tauri's `_up_` resource layout is resolved and sidecar
    startup failures land in the app runtime log with their actual cause.
*   Gemini and Claude desktop callback completion delegates token exchange and
    Antigravity setup to the native AI Router Core, avoiding WebView `Load
    failed` errors from direct provider requests.
*   Packaged desktop runtime resolves its bundled AI Router/Agent Runner from
    Tauri resources. The About view receives the build manifest version.
*   Desktop first sign-in now uses an explicit callback URL/authorization-code
    completion screen and enters Chat after the exchange succeeds. This avoids
    losing a fast browser callback before the Tauri webview subscribes.

## [1.0.1] - 2026-07-19
### Added
*   Chuyển phần kết nối model sang **AI Router native**: Provider Core được
    vendor vào repository và chạy local sidecar, kế thừa registry/adapter của
    upstream thay vì tạo adapter riêng cho từng vendor.
*   Bổ sung mô hình multi-account cho AI Router: một provider có thể có nhiều
    connection, mỗi connection có account label/email, priority và
    `credentialRef` riêng.
*   Bổ sung Model Packs (fallback/round-robin), account filter và model source
    metadata cho bộ chọn model.

### Changed
*   Vault trở thành boundary bắt buộc của AI Router: UI, agent và connector chỉ
    xử lý reference/metadata; sidecar mới resolve secret vào lúc thực thi.
*   Local User là profile thiết bị tạo từ lần AI sign-in đầu tiên. Logout gỡ
    profile và connection tạo profile, nhưng không xoá các vendor độc lập.
*   Pipeline release macOS chạy sau commit `main`, tự tăng patch từ tag gần
    nhất và tạo artifact Intel/Apple Silicon trước các nền tảng khác.

### Fixed
*   Tách trạng thái Local User account khỏi toàn bộ danh sách AI Router
    connections để tránh báo "connected" sai.
*   Giữ credential đã OAuth thành công khi model test thất bại do quota hoặc
    permission upstream.

## [1.2.0] - 2026-07-12
### Added
*   Đặc tả kiến trúc **Độc lập SDK (Universal Agent Loop)** loại bỏ hoàn toàn sự phụ thuộc vào `@anthropic-ai/claude-agent-sdk` và hỗ trợ đa nhà cung cấp (ChatGPT, Claude, Gemini, OpenRouter, LocalAI) trên cả 3 nền tảng macOS, Windows, Linux.
*   Thiết kế luồng cấu hình Agent bằng các file Markdown riêng biệt tương tự như Paperclip configuration.
*   Làm rõ vai trò của **Vault** làm module bảo mật mặc định (không phải connector) và các **Integrations/Connectors** kết nối vào Vault lấy credential an toàn.
*   Bổ sung đặc tả luồng chào mừng (Onboarding welcome screen) tự động bỏ qua sau khi đã đăng nhập lần đầu tiên thành công.
*   Thiết lập nền tảng cấu hình Tauri Launcher trong `runtime.rs` và `lib.rs` để tự khởi chạy NanoClaw nhúng dưới dạng Host Process.

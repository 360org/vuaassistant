# VuaAssistant — Ý tưởng sản phẩm & Thiết kế Kiến trúc (Kế thừa NanoClaw & Đa nhà cung cấp)

> **Mục tiêu chốt chặn:** Xây dựng ứng dụng trợ lý cá nhân dạng Desktop Agentic cực nhẹ, hỗ trợ MacOS/Windows/Linux, kế thừa toàn bộ cấu trúc & tính năng agentic của NanoClaw (đọc/ghi file, thực thi lệnh Terminal, MCP tools) nhưng **loại bỏ sự lệ thuộc vào Anthropic Claude SDK** và **hỗ trợ Đa nhà cung cấp (ChatGPT, Claude, Gemini, OpenRouter, LocalAI)**.

Tài liệu này đặc tả ý tưởng sản phẩm cuối cùng và làm cơ sở rà soát duyệt trước khi viết mã nguồn.

---

## 1. Tầm nhìn & Nguyên lý thiết kế

1. **Kế thừa Kiến trúc NanoClaw:**
   * Giữ nguyên cơ chế giao tiếp qua database SQLite IPC (`inbound.db`/`outbound.db`) và quản lý session của NanoClaw để tránh viết lại từ đầu.
   * Đồng bộ hóa cấu hình Agent thông qua hệ thống nhóm (`groups`) và thư mục làm việc cục bộ.

2. **Decouple khỏi Anthropic SDK (Universal Agent Loop):**
   * Xóa bỏ thư viện `@anthropic-ai/claude-agent-sdk` trong Agent Runner.
   * Thay thế bằng một **Vòng lặp Agentic tùy chỉnh (Universal Agent Loop)** viết bằng TS thuần, có khả năng giao tiếp với API của mọi nhà cung cấp (OpenAI, Anthropic, Google Gemini, OpenRouter) bằng cùng một tập công cụ (Tools).

3. **Chạy trực tiếp siêu nhẹ (Zero-Docker / Host Process):**
   * Sử dụng cơ chế chạy nền trực tiếp làm tiến trình hệ thống (**Host Process** - thông qua `bun` hoặc `node` trên máy host).
   * Không bắt buộc cài đặt Docker/Colima khi cài app, giúp cài đặt cực kỳ đơn giản (Download > Install > Login > Dùng ngay). Desktop đóng gói native sidecar cho Windows, macOS và Linux; Docker chỉ là profile triển khai server riêng.
   * Không expose Terminal/Bash cho model. Các công cụ file chỉ hoạt động trong workspace được cấp; tác vụ bên ngoài đi qua connector capability.
   * **Ví dụ luồng nghiệp vụ thực tế:** Người dùng ra lệnh: *"Em hãy thiết kế cho anh một chương trình quảng cáo Facebook"* -> Agent lập kế hoạch chiến dịch -> Người dùng cung cấp tài khoản/token liên kết từ Vault -> Agent tự động chạy chiến dịch qua API, tối ưu hóa ngân sách, theo dõi và xuất báo cáo tiến độ chi tiết cho người dùng.

---

## 2. Thiết kế Kiến trúc Agentic Độc lập SDK

```text
+--------------------------------------------------------------+
|            Tauri App (VuaAssistant UI & Desktop Shell)        |
|  +------------------+                   +------------------+ |
|  |     React UI     |                   | Telegram Bot     | |
|  +--------+---------+                   +--------+---------+ |
|           | (Tauri IPC)                          | (fetch)   |
|  +--------v---------+                            |           |
|  |Rust Desktop Shell|                            |           |
|  +---+----------+---+                            |           |
|      |          |                                |           |
|      |          | (Local Encrypted DB)           |           |
|      |     +----v--------------------+           |           |
|      |     |  VuaAssistant Vault      |           |           |
|      |     +-------------------------+           |           |
|      | (SQLite IPC)                              |           |
|  +---v-------------------------------------------v--------+  |
|  |              SQLite IPC Databases                      |  |
|  |  +-----------------------+    +---------------------+  |  |
|  |  | inbound.db (Messages) |    | outbound.db(Replies)|  |  |
|  |  +-----------+-----------+    +-----------^---------+  |  |
+--+--------------|----------------------------|------------+--+
                  | (Reads)                    | (Writes)
+-----------------|----------------------------|---------------+
|            Universal Agent Host Process (Bun Daemon)         |
|  +--------------v----------------------------+---------+   |
|  |                 Universal Agent Runner            |   |
|  +--------------------------+--------------------------+   |
|                             |                              |
|              +--------------v--------------+               |
|              |     Agent Loop Executor     |               |
|              +------+---------------+------+               |
|                     |               |                      |
|       +-------------v-----+   +-----v-------------+        |
|       |   Universal LLM   |   |   Native Tools    |        |
|       |      Client       |   | (Scoped FS, HTTP) |        |
|       +---------+---------+   +---------+---------+        |
+-----------------|-----------------------|--------------------+
                  |                       |
        +---------v---------+   +---------v---------+
        |   AI Providers    |   |   External APIs   |
        | (ChatGPT, Gemini, |   | (Notion, Github,  |
        |  Claude, OR...)   |   |  Slack...)        |
        +-------------------+   +-------------------+
```

---

## 3. Bản đồ Tính năng & Checklist triển khai

### A. Giao diện & Đón tiếp (Onboarding)
*   **[ ] Luồng Login Ưu tiên (OAuth/Subscription First):** 
    * Chỉ hiển thị nút đăng nhập subscription OAuth khi chưa cấu hình.
    * Sau khi đã login lần đầu thì đã khai báo xong local user, các lần tiếp theo khi mở app sẽ tự động chạy thẳng vào giao diện làm việc chính mà không cần hiển thị lại màn hình chào mừng (Welcome) hay bắt đăng nhập lại.
*   **[ ] Advanced Options (API Key/Endpoint):** 
    * Chỉ xuất hiện để chỉnh sửa sau khi đã đăng nhập thành công.
*   **[ ] Trình quản lý Tiến trình ngầm tự động:**
    * Tauri App tự động kích hoạt `NanoClaw` chạy nền dưới dạng Host Process (`process`) khi mở app, không hỏi Docker/Colima.

### B. Universal Agent Loop (Agent-Runner)
*   **[ ] Thay thế Claude SDK:**
    * Phát triển module `universal-executor.ts` thực thi vòng lặp Agent: Gửi prompt -> nhận lệnh gọi tool -> chạy tool -> nạp lại lịch sử -> phản hồi.
*   **[ ] Công cụ Cục bộ tự chế (Native Tools):**
    * Không cung cấp `Bash`/host shell cho model.
    * `FileRead` / `FileWrite` / `FileEdit`: Chỉ đọc, ghi và thay thế trong workspace được cấp.
    * `Grep` / `Glob`: Tìm kiếm file và nội dung nhanh chóng.
*   **[ ] Tự nâng cấp (Self-Improving Memory):**
    * Agent tự suy ngẫm sau mỗi cuộc hội thoại, cập nhật tóm tắt thông tin quan trọng vào file memory riêng của Agent để kế thừa cho các phiên chat sau.

### C. Kênh kết nối & Tích hợp (Telegram & Các kênh kết nối NanoClaw)
*   **[ ] Long-polling Telegram Bot & Các cổng Chat Adapter:**
    * Kế thừa đầy đủ cơ chế hoạt động của các kênh kết nối từ NanoClaw (mặc định tích hợp CLI, Telegram Bot).
    * Hỗ trợ cơ chế tự đăng ký của các cổng kết nối bổ sung (như Slack, Discord, WhatsApp...) thông qua Chat SDK Bridge để nhận tin nhắn, điều phối xử lý qua SQLite IPC và trả phản hồi về kênh tương ứng của người dùng.

### D. Agent (Bộ não độc lập & Tri thức RAG)
*   **[ ] Phân tách vai trò triệt để (Role Isolation):**
    * Mỗi Agent là một bộ não độc lập (định nghĩa bởi instructions + soul + memory riêng biệt). Việc chuyển đổi Agent không làm pha trộn dữ liệu.
    * Người dùng có thể tạo nhiều file markdown khác nhau để định nghĩa và cấu hình cho Agent, tương tự như cách khai báo trong cấu hình Paperclip (Paperclip configuration).
*   **[ ] Nạp tri thức cục bộ (Knowledge RAG):**
    * Hỗ trợ tải lên tài liệu (PDF, Word, Excel, PowerPoint, Text) cục bộ.
    * Tự động trích xuất nội dung (on-device parsing) và truy vấn ngữ cảnh (TF-IDF cục bộ) để đưa vào làm căn cứ câu trả lời cho Agent.

### E. Skills (Kỹ năng thực thi)
*   **[ ] Cài đặt & Khởi chạy Kỹ năng (Agent Skills):**
    * Kế thừa hệ thống Agent Skills chuẩn hóa (`skills/*/SKILL.md`). Inject hướng dẫn kỹ năng vào prompt của Agent khi kỹ năng đó được kích hoạt.
*   **[ ] Model Context Protocol (MCP Tools):**
    * Tích hợp máy chủ MCP bên ngoài và built-in (được khai báo qua `container.json`) để Agent tự do gọi và sử dụng các tools mở rộng bên ngoài.

### F. Kho bảo mật Vault & Tích hợp (Integrations & Connectors)
*   **[ ] Vault - Kho lưu trữ bảo mật mặc định:**
    * Là tính năng cốt lõi của VuaAssistant (không phải lấy từ OS/keychain của macOS hay Windows). Đây là một cơ sở lưu trữ dữ liệu an toàn được mã hóa và quản lý trực tiếp bởi VuaAssistant, chứa toàn bộ API Keys, tài khoản, Tokens và cấu hình tích hợp của người dùng.
*   **[ ] Tích hợp & Liên kết (Integrations & Connectors) kết nối vào Vault:**
    * Định nghĩa sẵn các cổng kết nối dịch vụ bên ngoài (GitHub, Notion, Slack, Discord, Telegram).
    * Agent chỉ query danh sách `credential_ref` và tên biến. Trusted Connector Gateway trong AI Router mới được đọc Vault, resolve credential trong memory, bind request vào origin đã lưu và redaction response trước khi trả về Agent.
*   **[ ] Công cụ Web HTTP linh hoạt:**
    * `http_request` chỉ dùng cho request không xác thực. Request cần credential phải dùng `connector_request` với `vault-entry:<id>` và biến `{{credential:field}}`; Agent không được đọc password/token/auth code/API key.

---

## 5. Học từ Loop Engineering — nâng cấp Agent Runner

> Nguồn: [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)
> (MIT). Repo đó dành cho **agent lập trình** chạy không người trông trong CI.
> Ta **không bê nguyên** hệ sinh thái npm, điểm "Loop Ready", hay các pattern
> gắn chặt GitHub (PR Babysitter, CI Sweeper) — chúng giải bài toán khác. Cái
> đáng lấy là **cơ chế điều khiển vòng lặp**, vì VuaAssistant cũng chạy vòng lặp
> agentic không người trông (scheduler, kênh Telegram) trên **tiền thật của
> người dùng** — mỗi vòng lặp vô ích là tiền token của Sếp và của khách.

### 5.1 Vấn đề đang có trong `poll-loop.ts`

Đối chiếu mã hiện tại, vòng lặp tool-calling chỉ có đúng **một** cơ chế phanh:

```ts
const MAX_TOOL_ITERATIONS = 25;
for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) { … }
```

Đây là phanh cùn. Ba lỗ hổng cụ thể:

1. **Không phát hiện giậm chân tại chỗ.** Agent gọi một tool hỏng, nhận cùng
   một lỗi, rồi gọi lại y hệt — 25 lần. Người dùng trả tiền cho 25 lượt gọi
   model để nhận về đúng một thông báo lỗi.
2. **Không có ngân sách.** Không đếm token, không có trần theo ngày, không có
   công tắc ngắt. Một tác vụ lịch chạy hỏng lúc 2 giờ sáng có thể chạy lại mỗi
   giờ cho tới sáng mà không ai biết.
3. **Lịch sử hội thoại phình không giới hạn.** Mỗi vòng đẩy nguyên
   `result.content` của tool vào `conversationHistory`, không cắt. Đến vòng 20
   thì prompt đầy stack trace cũ, model quên mất mục tiêu ban đầu — đúng hiện
   tượng "context rot" repo kia mô tả. Càng nhiều rác thì càng đắt, mà càng đắt
   thì chất lượng càng tệ.

### 5.2 Bốn thứ nên lấy, theo thứ tự giá trị

**A. Circuit breaker cho vòng lặp agentic** *(giá trị cao nhất, chi phí thấp nhất)*

Học từ `loop-context --check`. Trước mỗi vòng lặp, kiểm bốn điều kiện dừng
thay vì chỉ đếm số vòng:

| Điều kiện | Ngưỡng gợi ý | Ý nghĩa |
|---|---|---|
| Số vòng | 25 (giữ nguyên) | Trần cứng |
| Giậm chân (`stagnation`) | cùng một lỗi 3 lần liên tiếp | Agent đang lặp vô ích |
| Không tiến triển | 5 tool call hỏng liên tiếp | Hướng đi sai |
| Ngân sách token | theo cấu hình | Chạm trần thì dừng |

Ba trạng thái ra: `tiếp tục` · `chỉ báo cáo` (không side effect) · `hỏi người
dùng`. Điểm mấu chốt: **hoàn toàn tất định, không cần gọi model** để quyết
định — nên rẻ tới mức chạy được ở mọi vòng lặp.

Với VuaAssistant, "escalate" không phải mở issue mà là **nhắn thẳng cho người
dùng**: "Em thử 3 lần đều lỗi *X*, dừng lại để khỏi tốn thêm. Sếp muốn em thử
cách khác không?" — đúng tinh thần lỗi phải ra câu người hiểu (#13).

**B. Sổ ghi lần thử (ledger) + cắt tỉa ngữ cảnh tất định**

Học từ `loop-context --prune`. Giữ một sổ trong bộ nhớ: mỗi lần thử ghi
`{iteration, action, outcome, error, tokensUsed}`. Sổ này vừa nuôi circuit
breaker ở mục A, vừa cho phép cắt tỉa **không cần model**:

- giữ N lần thử gần nhất, bỏ phần cũ;
- gộp lỗi lặp lại ("lỗi này đã gặp 4 lần") thay vì dán lại 4 lần;
- cắt stack trace còn vài dòng đầu.

Lợi ích kép: rẻ hơn **và** chính xác hơn, vì model không còn phải bơi trong
rác. Đây là thứ hợp với VuaAssistant nhất vì ta chạy trên máy người dùng, cắt
được token nào là tiền thật của họ.

**C. Vai trò kiểm tra (maker/checker)**

Học từ skill `loop-verifier`, tinh thần: **mặc định là TỪ CHỐI cho tới khi có
bằng chứng**. Ta đã có cách ly vai trò (mỗi vai một bộ nhớ riêng) nhưng chưa có
vai *kiểm*. Với các việc có hậu quả thật — đúng ví dụ trong tài liệu này là
Agent tự chạy chiến dịch quảng cáo Facebook bằng tiền của khách — một vai kiểm
độc lập xem lại trước khi bấm nút là chốt chặn đáng giá. Vai kiểm chỉ trả ba
kết quả: `DUYỆT` · `TỪ CHỐI + lý do` · `HỎI NGƯỜI DÙNG`.

Lưu ý: vai kiểm **không được** dùng chung phiên với vai làm, nếu không nó chỉ
gật đầu với chính mình.

**D. Ràng buộc do người dùng khai báo, tách khỏi mã**

Học từ `loop-constraints.md` + `gate.yaml`. Hiện luật của ta nằm **trong mã**
(`capability-rail.ts`, `sideEffectDenied`, `approved-read-paths.json`) — Sếp
muốn đổi luật thì phải sửa mã và phát hành lại. Repo kia tách làm hai tầng:
văn bản cho người đọc, YAML cho máy thi hành.

Với VuaAssistant nên là **một màn hình trong Settings** ghi xuống một tệp
chính sách, thay vì bắt người dùng viết YAML:

- không được gửi ra ngoài quá N tin/giờ;
- không được tiêu quá X đồng ngân sách quảng cáo mỗi ngày;
- luôn hỏi trước khi gửi email/tin ra ngoài;
- danh sách đường dẫn cấm đọc/ghi.

Điểm quan trọng học được: **luật phải được máy thi hành**, không phải chỉ nhét
vào system prompt và mong model nghe lời. Prompt là gợi ý; rail mới là luật.

### 5.3 Những thứ nên bỏ qua

- **Điểm "Loop Ready" và bộ CLI đi kèm.** Chấm điểm cấu hình là trò cho người
  làm hạ tầng, người dùng cuối của ta không quan tâm.
- **Các pattern gắn GitHub** (PR Babysitter, CI Sweeper, Dependency Sweeper) —
  dành cho agent lập trình, không phải trợ lý cá nhân.
- **`loop-sandbox` (worktree git + patch).** Ta đã có sandbox WASM tuỳ chọn và
  công cụ file bị giới hạn trong workspace được cấp; thêm tầng git worktree chỉ
  làm nặng máy người dùng mà không thêm an toàn thật.
- **Toàn bộ ngăn xếp năm tầng** (memory → loop → foundry → outerloop → fleet).
  Ta là ứng dụng desktop một máy, không phải đội agent chạy trên hạ tầng.

### 5.4 Việc cần làm (chưa làm)

*   **[ ] Circuit breaker trong `poll-loop.ts`:** phát hiện giậm chân + không
    tiến triển + trần token, ba trạng thái ra, tất định không gọi model. Kèm
    test dựng đúng tình huống lặp vô ích và khẳng định vòng lặp dừng sớm.
*   **[ ] Sổ lần thử + cắt tỉa ngữ cảnh tất định:** gộp lỗi lặp, cắt trace, giữ
    cửa sổ gần nhất. Đo lại số token trước/sau để chứng minh có rẻ đi thật.
*   **[ ] Báo cho người dùng khi dừng sớm:** câu tiếng Việt nói rõ đã thử gì,
    hỏng vì sao, đề nghị bước tiếp — không im lặng bỏ cuộc, không đổ JSON thô.
*   **[ ] Vai kiểm độc lập trước hành động có hậu quả thật:** phiên riêng, mặc
    định từ chối.
*   **[ ] Màn hình chính sách trong Settings:** ghi xuống tệp chính sách và
    được capability rail thi hành, không chỉ nằm trong prompt.
*   **[ ] Ngân sách token theo ngày cho tác vụ lịch:** chạm 80% chuyển sang chỉ
    báo cáo, chạm trần thì dừng và báo Sếp.

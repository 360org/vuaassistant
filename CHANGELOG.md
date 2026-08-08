# Nhật ký thay đổi (Changelog)

Ghi lại mọi thay đổi đáng chú ý của V Assistant. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/); phiên bản theo
[SemVer](https://semver.org/).

## [Chưa phát hành]

### Tính năng mới
- **Phanh cho vòng lặp agentic** (`agent-runner/src/loop-guard.ts`): trước đây
  vòng lặp tool-calling chỉ có đúng một cái phanh là trần 25 vòng. Đó là phanh
  cùn — agent gọi một tool hỏng, nhận về cùng một lỗi, rồi gọi lại y hệt cho
  tới hết 25 vòng; người dùng trả tiền cho 25 lượt gọi model để nhận về đúng
  một thông báo lỗi. Nay có thêm ba điều kiện dừng, **hoàn toàn tất định**
  (không gọi model để quyết định, nên rẻ đủ để chạy ở mọi vòng):

  | Điều kiện | Ngưỡng | Ý nghĩa |
  |---|---|---|
  | Giậm chân | cùng một lỗi 3 lần liên tiếp | Agent đang lặp vô ích |
  | Không tiến triển | 5 tool call hỏng liên tiếp | Hướng đi sai |
  | Trần token | theo cấu hình | Chỉ bật khi có ngân sách |

  Điểm mấu chốt: lỗi được so bằng **dấu vân tay** chứ không so nguyên văn. Hai
  lần thử cùng một việc hỏng hiếm khi cho ra chuỗi giống hệt nhau (số cổng, id
  request, thời điểm đổi mỗi lần), nên so nguyên văn sẽ không bao giờ thấy
  "cùng một lỗi" và cái phanh thành vô dụng.
- **Cắt tỉa ngữ cảnh, tất định** (`agent-runner/src/context-prune.ts`): lịch sử
  hội thoại được gửi lại **nguyên vẹn** ở mỗi vòng lặp tool, nên chi phí tăng
  theo bình phương số vòng nếu không cắt — và đến vòng 20 thì prompt đầy stack
  trace cũ, model bơi trong rác rồi quên mất mục tiêu. Nay trước khi gửi:

  - gộp lỗi lặp (dán lại nguyên văn cùng một lỗi 4 lần không thêm thông tin gì);
  - cắt stack trace còn 8 khung đầu;
  - rút gọn kết quả tool dài, **giữ cả đầu lẫn đuôi** (đầu nói lỗi gì, đuôi
    thường mang mã lỗi hoặc gợi ý xử lý);
  - bỏ cụm công cụ quá cũ khi lượt đã dài, nhưng luôn giữ mục tiêu ban đầu.

  Đo trên bộ test: gộp lỗi lặp ~2420 → ~627 token; kết quả dài ~6826 → ~1593.
  Mọi chỗ đều ghi rõ "đã bỏ bớt bao nhiêu" chứ không cắt lén.

  Hai điều **bắt buộc giữ**, vì phá là hỏng nhà cung cấp chứ không phải chỉ tốn
  tiền: mỗi `assistant` có tool call phải còn đủ `tool` đi kèm, và không được
  để `tool` mồ côi — Gemini từ chối cả request khi function call không khớp cặp.
- **Dừng sớm là báo cho người dùng, không im lặng bỏ cuộc**: khi phanh cắt vòng
  lặp, câu trả về nói rõ đã thử gì, hỏng vì sao và đề nghị bước tiếp — bằng
  tiếng Việt, có kèm lỗi thật, không lộ tên lý do nội bộ và không đổ JSON thô
  (cùng chuẩn với #13).

## [1.1.57] - 2026-08-08

> Bản này sửa lỗi nặng nhất từ trước tới nay: **Windows 11 cài xong không mở
> được app**. Ai đang dùng Windows nên cập nhật.

### Sửa lỗi
- **Bấm "Start chatting" không đi đâu ở lối dùng thử không cần tài khoản**: App
  chỉ hiển thị màn hình chính khi có hồ sơ người dùng cục bộ
  (`!onboarded || !user` ⇒ quay lại Onboarding). Bốn lối đăng nhập thật đều tạo
  hồ sơ trong `connectProvider`, nhưng lối "Try the preview without an account"
  thì không — nên `completeOnboarding` đặt `onboarded = true` xong, App vẫn đá
  người dùng ngược về đúng màn hình vừa bấm. Nhìn y hệt nút hỏng: bấm, không có
  gì xảy ra, không báo lỗi. Nay lối đó tự tạo hồ sơ cục bộ trước khi vào ứng
  dụng. Phát hiện khi chạy app thật và chụp lại từng bước, không phải từ đọc mã.
- **Windows 11 cài xong bấm vào không mở được** (#8): app đăng ký phím tắt toàn
  cục bằng `with_shortcuts(["Cmd+Shift+Q", "Cmd+Shift+R", "Cmd+Shift+E"]).unwrap()`.
  Trên Windows, "Cmd" ánh xạ thành phím Windows, mà **Win+Shift+R là tổ hợp quay
  màn hình do chính Windows 11 giữ**. Đăng ký hỏng, `unwrap()` panic ngay lúc
  dựng app:

  ```
  PluginInitialization("global-shortcut", "HotKey already registered:
    HotKey { mods: Modifiers(SHIFT | SUPER), key: KeyR, id: 570425380 }")
  thread 'main' panicked at src/lib.rs
  ```

  Tiến trình chết với mã 101 **trước khi cửa sổ kịp hiện**, nên người dùng chỉ
  thấy "bấm vào không lên gì" — không thông báo, không log. Sửa theo hai hướng:
  máy không phải macOS dùng `Ctrl+Alt` thay vì phím Windows, và quan trọng hơn,
  việc đăng ký chuyển xuống `setup` theo từng tổ hợp — tổ hợp nào bị chiếm thì
  bỏ qua đúng tổ hợp đó và ghi log. **Phím tắt là tiện ích, không bao giờ được
  là điều kiện để app chạy.**
- **Kết nối xong nhưng không có model để chat** (#19 macOS, #16): danh sách model
  chỉ hiện khi kết nối đạt trạng thái `Verified`, trong khi mọi lần đăng nhập mới
  đều bắt đầu ở `Pending test`. Người dùng đăng nhập xong thấy 0 model và không
  chat được; chỉ cần một lần smoke test chập chờn (giới hạn tốc độ, lỗi 5xx tạm
  thời, model dò đã bị nhà cung cấp gỡ) là ứng dụng thành vô dụng dù thông tin
  đăng nhập vẫn tốt. Nay cổng lọc đảo chiều: `Pending test` vẫn phục vụ model,
  chỉ kết nối bị smoke test **từ chối** (`Failed`) mới bị ẩn. Lỗi tải danh mục
  model động cũng không còn xoá sạch danh mục tĩnh đã có.
- **Lỗi nhà cung cấp hiển thị JSON thô** (#13): tài khoản Deepseek hết số dư đổ
  nguyên khối JSON lồng nhau lên giao diện khiến người dùng tưởng ứng dụng hỏng.
  Bổ sung `providerErrors.ts` bóc thông điệp trong cùng kèm mã HTTP rồi dịch sang
  câu tiếng Việt có hướng xử lý (hết số dư, sai khoá, hết hạn mức, máy chủ lỗi,
  mất mạng…).
- **Thư mục dữ liệu chưa thống nhất** (#15): Agent Runner vẫn mặc định
  `~/.v-vuaai` nên khi `VUA_DATA_DIR` chưa được đặt thì runner đọc/ghi lệch chỗ
  so với vỏ desktop. Đồng bộ toàn bộ về `~/vuaai-data`.

- **Đăng nhập xong vẫn bị bắt thêm AI provider lần nữa** (#18): Onboarding ghi
  kết nối vừa đăng nhập vào AI Router nhưng nuốt lỗi bước này
  (`.catch(console.error)`) rồi vẫn hoàn tất. Khi ghi hỏng, người dùng vào
  thẳng ứng dụng mà **không có kết nối nào** và phải mở Settings thêm provider
  một lần nữa — sai luồng chuẩn "tải → cài → đăng nhập → chat". Nay cả ba lối
  đăng nhập đều chờ ghi xong; hỏng thì thử lại một lần sau khi khởi động lại AI
  Router, vẫn hỏng thì báo lỗi rõ kèm hướng xử lý thay vì đưa người dùng vào
  một ứng dụng chết.

### Chưa xử lý — cần thêm dữ liệu
- **Đăng nhập Gemini/Claude/ChatGPT lỗi trên Windows 10 Home Single Language**
  (#11, #12, #14): người dùng báo Google trả `400: invalid_request`
  (`flowName=GeneralOAuthFlow`). Lỗi hiện **trên trang Google**, tức bị từ chối
  ngay ở bước uỷ quyền — **trước** mọi redirect. Vì vậy nguyên nhân nằm trong
  chính URL uỷ quyền (`client_id`, `redirect_uri`, hoặc `scope`), không phải ở
  khâu nhận callback. Cần URL uỷ quyền thật mà người dùng gặp để chẩn đoán.

  > **Đã thử và đã revert** (`3b28047` → `ed9ba92`): một relay hứng callback ở
  > cổng 1420 được thêm vào rồi gỡ, vì dựa trên tiền đề sai — xem "Ghi nhớ kiến
  > trúc" bên dưới. Đừng đi lại hướng này.

### Ghi nhớ kiến trúc — tránh lặp lại chẩn đoán sai
- **OAuth **không** chạy trong webview, và desktop **không** hứng callback.**
  Luồng đăng nhập desktop là: `Onboarding` → `beginManualSignIn` → mở **trình
  duyệt hệ thống** (`openExternal`) → người dùng đăng nhập → **tự dán URL
  callback trở lại ứng dụng** (`setStep("manual")`). Không có listener nào chờ
  mã uỷ quyền.
- Hệ quả khi chẩn đoán: **cổng 1420 không cần ai lắng nghe** trong bản đóng gói.
  Suy luận kiểu "bản đóng gói không phục vụ `/callback` nên mã không quay về" là
  **sai** — mã quay về bằng thao tác dán. Chỉ Codex (1455) và xAI (56121) có
  relay, vì hai nhà cung cấp đó cần, không phải vì mọi nhà cung cấp đều cần.
- Chữ "WebView" còn trong mã nguồn chỉ **nơi Tauri render giao diện**
  (WebView2/WKWebView) — bản chất của Tauri. Đừng nhầm với "OAuth trong
  webview", thứ đã được bỏ từ trước.
- Phân biệt khi đọc lỗi OAuth: lỗi hiện **trên trang nhà cung cấp** thuộc bước
  uỷ quyền (sai tham số/đăng ký client); lỗi hiện **trong ứng dụng** mới thuộc
  bước đổi mã hoặc nhận callback. Xác định đúng bước trước khi sửa.

### Hạ tầng kiểm thử
- **Job `rust` trong CI đã đỏ suốt nhiều bản phát hành**: `tauri.conf.json` khai
  báo `agent-runner/dist` và `runtime/node` là resource nhưng job chỉ checkout
  rồi chạy `cargo check`, nên build script Tauri dừng ngay. Hệ quả nặng hơn CI
  đỏ: hai bài kiểm tra Rust phía sau (loopback OAuth, WASM sandbox) bị *skipped*
  — hợp đồng đăng nhập desktop và sandbox chạy code thực tế không được kiểm
  chứng ở bất kỳ bản gần đây nào. Job nay dựng đủ resource trước khi biên dịch.
- **8 contract check trước đây chỉ chạy tay** qua `npm run check`, nên hồi quy về
  AI Router / OAuth / Vault lọt lưới cho tới khi người dùng báo lỗi. Nay chạy
  trong CI.
- `ai-router-contract-check` trỏ nhầm `ModelSettings.tsx` sau khi logic dời sang
  `aiRouter.ts`, khiến `npm run check` đỏ oan; nay kiểm tra ở client dùng chung
  và bao cả hai lối đăng nhập (Settings và Onboarding).
- Thêm `models-availability-check` và `provider-error-check`; cả hai đã được thử
  nghịch đảo để xác nhận bắt đúng lỗi cũ.
- **Smoke test chạy app thật** (`desktop-smoke-check.mjs`) trên Linux (xvfb),
  Windows và macOS: mở đúng binary đã build rồi khẳng định app không thoát sớm,
  AI Router trả `/health`, Agent Runner còn đập nhịp, IPC + Vault được tạo, và
  WebView thật sự nạp được `index.html` kèm bundle JS. Chính bài này bắt được
  #8 — thứ mà mọi bài kiểm tra logic đều bỏ lọt vì lỗi nằm ở lúc dựng app.
- Thêm `hotkey-conflict-check.mjs`: mở **hai bản app cùng lúc trên một màn
  hình** để bản thứ hai gặp đúng lỗi "HotKey already registered" mà Windows gây
  ra, rồi đòi nó vẫn phải sống. Đã thử nghịch đảo (dựng lại đúng mã cũ) — bài
  test đỏ với `panicked at src/lib.rs`, khẳng định nó bắt đúng lỗi.

### Ghi nhớ khi kiểm thử — tránh lặp lại
- **Bài test phải tự giết được chính lỗi nó nói là bắt.** Mỗi bài mới ở trên đều
  được chạy ngược trên mã lỗi cũ trước khi tin. Không làm bước này thì có test
  xanh mà lỗi vẫn ra tới người dùng.
- **Xanh ở tầng logic không có nghĩa app mở được.** #8 nằm ở `tauri::Builder`,
  trước cả dòng giao diện đầu tiên; không một bài kiểm tra TypeScript nào chạm
  tới. Lỗi "cài xong không mở được" chỉ có thể bắt bằng cách mở app thật.
- **Hai bản app phải dùng chung một màn hình mới tranh nhau tài nguyên toàn
  cục.** Bọc mỗi bản trong một `xvfb-run -a` riêng sẽ cho hai màn hình khác
  nhau và xung đột không bao giờ xảy ra — bài test sẽ xanh giả.
- **Đừng dọn tiến trình theo tên ảnh trên Windows**: `taskkill /IM node.exe /F`
  giết luôn tiến trình đang chạy test, nên phần chẩn đoán không bao giờ được in
  ra và Windows đỏ suốt nhiều lần mà không ai biết vì sao. Dùng
  `taskkill /PID <pid> /T /F`.

## [1.1.52] - 2026-08-04

### Tính năng mới & Trải nghiệm người dùng
- **Hành động Reply & Retry**: Bổ sung hai nút bấm "Trả lời" (trích dẫn tin nhắn dạng blockquote) và "Thử lại" (gửi lại yêu cầu trước đó của user) trực tiếp dưới các bong bóng chat của AI.
- **Thư mục dữ liệu mới `~/vuaai-data`**: Chuyển đổi toàn bộ đường dẫn lưu trữ mặc định của app từ tệp ẩn `.v-assistant/data` sang thư mục nổi `~/vuaai-data` giúp tăng nhận diện thương hiệu Vua AI và giúp người dùng dễ dàng quản lý tệp tin, custom skills, sao lưu.
- **Tự động Code Sign & Notarize**: Tích hợp các kho mật khẩu của Apple Developer lên GitHub Actions để tự động ký số ứng dụng và chứng thực bảo mật trực tiếp với Apple khi phát hành, gỡ bỏ lỗi cảnh báo "unidentified developer" trên macOS.
- **Tự động lưu xuất tệp sao lưu**: Khi chạy trên bản Desktop, thao tác xuất sao lưu sẽ tự động ghi trực tiếp thành tệp tin vật lý trong thư mục `~/vuaai-data/backup/` thay vì kích hoạt tải xuống của trình duyệt.
- **Khắc phục lỗi cổng AI Router**: Chuyển cổng mặc định của sidecar sang `36360` để đồng bộ với backend mới và sửa lỗi AI Router tự động dừng sau khi mở.

### Kiểm chứng
- `npm run check` — pass toàn bộ.
- Kiểm tra chữ ký số Gatekeeper trên macOS local — pass (`accepted, source=Notarized Developer ID`).

## [1.1.50] - 2026-08-04

### Sửa lỗi Windows/Desktop
- **Đổi cổng AI Router sang 36360 (360 CORP)**: Tránh hoàn toàn xung đột cổng `20128` cố định cũ của 9router hoặc phiên bản cũ chạy ngầm.
- **Sửa lỗi cú pháp healthcheck**: Sửa ký tự ngắt dòng `\r\n` chuẩn trong `TcpStream` của Rust backend, sửa lỗi HTTP 400 khiến app hiểu nhầm AI Router chưa chạy và tự động kill process.
- **Tên binary trong Smoke Test**: Đồng bộ tên file tìm kiếm từ `V Assistant.exe` thành `v-assistant.exe` trong GitHub Actions.

### Kiểm chứng
- `npm run check` — pass toàn bộ.
- Contract port 36360, resource/runtime, OAuth, Host Process, credential boundary, connector, isolation và RAG — pass.

## [1.1.49] - 2026-08-04

### Hotfix Windows AI Router
- AI Router chờ endpoint `/health` sẵn sàng trước khi báo khởi động thành công; lỗi startup kèm log tail để chẩn đoán.
- Onboarding polling health tối đa 10 giây sau restart thay vì chờ cứng 2,5 giây, tránh kẹt ở bước đăng nhập AI account.
- Không kill bừa process ngoài khi port `20128` bị chiếm; chỉ dừng đúng process AI Router có `sidecar.mjs`.
- Windows release smoke test bắt buộc kiểm tra `v-assistant.exe`, `sidecar.mjs`, Agent Runner `index.js` và `node.exe` sau cài đặt.

### Kiểm chứng
- `npm run check` — pass toàn bộ.
- Contract resource/runtime, OAuth, Host Process, credential boundary, connector, isolation và RAG — pass.

## [1.1.48] - 2026-08-04

### Sửa lỗi Windows/Desktop
- AI Router giờ chờ endpoint `/health` sẵn sàng trước khi báo khởi động thành công; lỗi startup kèm log tail để chẩn đoán.
- Onboarding polling health tối đa 10 giây sau restart thay vì chờ cứng 2,5 giây, tránh kẹt ở bước đăng nhập AI account.
- Không còn kill bừa process ngoài khi port `20128` bị chiếm; chỉ dừng đúng process AI Router có `sidecar.mjs`.
- Windows release smoke test bắt buộc kiểm tra `v-assistant.exe`, `sidecar.mjs`, Agent Runner `index.js` và `node.exe` sau cài đặt.

### Kiểm chứng
- `npm run check` — pass toàn bộ.
- Contract resource/runtime, OAuth, Host Process, credential boundary, connector, isolation và RAG — pass.

## [1.1.47] - 2026-08-04

### Sửa lỗi Windows/Desktop
- **Native menu desktop**: Bổ sung cấu trúc menu macOS gồm V Assistant, File, Edit, View, Window và Help.
- **Filesystem approval**: Cho phép chọn file hoặc thư mục để cấp quyền đọc cho Agent Runner; đường dẫn được chuẩn hóa trước khi lưu.
- **Updater placement**: Đưa khu vực cập nhật phần mềm lên đầu trang Settings và hiển thị nút cập nhật rõ ràng trên Sidebar.
- **Local build**: Tắt updater artifacts cho `build:local` để bản cài local không bị nhầm là release artifact.
- **Checklist và skill workflow**: Bổ sung checklist multi-sub-agent và skill xử lý GitHub Issues.

### Kiểm chứng
- `npm run check` — pass toàn bộ trên `main` sau merge.
- Desktop bundle, OAuth, Host Process, AI Router, credential boundary, connector, isolation và RAG — pass.

## [1.1.41] - 2026-08-02

### Sửa lỗi Windows/Desktop
- **Native menu desktop**: Bổ sung cấu trúc menu macOS gồm V Assistant, File, Edit, View, Window và Help.
- **Filesystem approval**: Cho phép chọn file hoặc thư mục để cấp quyền đọc cho Agent Runner; đường dẫn được chuẩn hóa trước khi lưu.
- **Updater placement**: Đưa khu vực cập nhật phần mềm lên đầu trang Settings và hiển thị nút cập nhật rõ ràng trên Sidebar.
- **Local build**: Tắt updater artifacts cho `build:local` để bản cài local không bị nhầm là release artifact.
- **Checklist và skill workflow**: Bổ sung checklist multi-sub-agent và skill xử lý GitHub Issues.

### Kiểm chứng
- `npm run check` — pass toàn bộ trên `main` sau merge.
- Desktop bundle, OAuth, Host Process, AI Router, credential boundary, connector, isolation và RAG — pass.

## [1.1.41] - 2026-08-02

### Thêm mới
- **Capability rail nội bộ cho Agent Runner**: Agent có thể tìm và chạy native tools, built-in tools và MCP tools qua một bề mặt thống nhất.
- **Cổng duyệt thao tác nhạy cảm**: Gửi tin, gửi file ra ngoài, sửa message và connector có credential yêu cầu người dùng phê duyệt trước khi thực thi.
- **Câu hỏi tương tác và lịch chạy**: Bổ sung `ask_user_question`, `schedule_message`, `list_scheduled` và `cancel_scheduled` cho Agent Runner.
- **Phím tắt macOS**: Thêm `Cmd+Shift+Q` ẩn/hiện cửa sổ, `Cmd+Shift+R` tải lại ứng dụng và `Cmd+Shift+E` phát sự kiện cho webview.
- **Remote MCP và chẩn đoán**: Cấu hình MCP từ URL và xuất gói chẩn đoán đã che thông tin nhạy cảm.

### Sửa lỗi và bảo mật
- Telegram đi qua hàng đợi SQLite inbound/outbound thay vì gọi trực tiếp agent loop, đồng bộ với kiến trúc Host Process.
- Chuẩn hóa toàn bộ approved roots trước khi kiểm tra containment, ngăn path traversal qua đường dẫn tương đối.
- RAG, Scheduler và self-improve memory chạy trong Host Process để tiếp tục hoạt động khi đóng cửa sổ.
- Skill Store lưu nguồn và version của skill để người dùng biết xuất xứ trước khi bật.

### Kiểm chứng
- `npx tsc --noEmit` — đạt.
- `npx tsc --project agent-runner/tsconfig.json --noEmit` — đạt.
- `cargo check --quiet` — đạt.
- `npm run build` — đạt, 2.009 module.

## [1.1.2] - 2026-07-26

- **Persistent Background Task Execution**: Giữ trang Trò chuyện (`Chat`) luôn mounted ngầm trong DOM (`hidden` khi ở trang khác). Khi Agent đang thực thi tác vụ (đọc/ghi tệp, gọi API, đặt lịch...), người dùng chuyển qua menu/trang khác (Lịch & Nhiệm vụ, Kho Media, Cài đặt...) thì tiến trình vẫn tiếp tục chạy hoàn tất 100% mà không bị dừng hay báo lỗi Retry.

## [1.1.1] - 2026-07-26

- **Lịch & Nhiệm vụ Menu**: Đổi tên nhãn menu hiển thị ở Sidebar từ "Lịch đăng bài & Tác vụ" thành **"Lịch & Nhiệm vụ"**.
- **Native Tool `schedule_task`**: Tích hợp công cụ native cho Agent Runner tự động đưa tác vụ lên lịch vào mục **Lịch & Nhiệm vụ** của ứng dụng V-Assistant.
- **Backup Timestamp & Success Banner**: Xuất file backup kèm timestamp đầy đủ (`v-assistant-backup-YYYY-MM-DD_HHmmss.json`) và hiển thị thông báo thành công.
- **Run on Startup Option**: Thêm công tắc tự động khởi động cùng hệ thống trong Cài đặt hệ thống (bật/tắt daemon `LaunchAgents` trên macOS).
- **Fix File Upload Hanging**: Thêm cơ chế Hard Timeout 4s/6s chống kẹt trạng thái **Processing** khi nạp tệp PDF, DOCX, XLSX, hình ảnh.
- **Claude Desktop Capabilities Roadmap**: Bổ sung Checklist mục 13 chi tiết các tính năng Computer Use & Advanced Capabilities.

## [1.0.15] - 2026-07-20

### Sửa lỗi
- **OAuth credential rotation trong AI Router.** Khi provider trả `401` và refresh token tạo access/refresh token mới, AI Router ghi ngay credential đã refresh về App Vault. Các lần chat sau hoặc sau khi khởi động lại không còn quay về token cũ đã hết hạn.
- **Trạng thái session bị thu hồi.** Claude, Grok và các provider OAuth khác trả `401`/`403` giờ chuyển connection sang `Failed` với hướng dẫn Reset và đăng nhập lại, thay vì giữ nhãn `Verified` hoặc hiển thị JSON lỗi upstream thô.

### Kiểm chứng
- **Runtime desktop macOS.** Đã kiểm tra trực tiếp AI Router trong ứng dụng cài đặt: Gemini/Antigravity và ChatGPT/Codex trả `200` từ upstream. Grok Build có token bị xAI thu hồi được báo rõ cần đăng nhập lại.

### Sửa lỗi
- **Desktop AI Router CORS.** Router tin cậy origin WebView của Tauri, nên
  onboarding và Settings có thể tải catalog vendor thay vì chỉ hiện `Load failed`.
- **Provider Core package nội bộ.** `open-sse` kế thừa chạy trực tiếp từ một
  bản source dưới `ai-router/core`; bundle desktop không còn vô tình load bản
  copy trong `node_modules` với các đường dẫn nội bộ sai.
- **Standalone macOS AI Router.** Release bundle mang Node runtime tối thiểu
  và dependency runtime (`undici`, `uuid`, `node-machine-id`) cho AI Router
  Core qua lockfile npm đã kiểm soát, resolver nhận đúng layout Tauri
  `Resources/_up_`, và ghi lỗi khởi động sidecar vào `ai-router.log` thay vì
  chỉ trả `Load failed`.
- **Gemini/Claude desktop OAuth.** Authorization-code exchange và Antigravity
  project setup chạy trong AI Router sidecar. WebView chỉ giữ callback code để
  dán, không còn gọi trực tiếp Google/Anthropic rồi trả lỗi mạng `Load failed`.
- **Desktop packaged runtime.** Bản cài dùng đúng thư mục `Contents/Resources`
  để khởi chạy AI Router/Agent Runner đã bundle, thay vì nhầm thư mục chạy của
  ứng dụng. Mục About lấy version từ manifest khi build, không còn hard-code
  `0.1.0`.
- **Desktop first sign-in.** Sau khi mở trang xác thực AI, onboarding desktop
  hiển thị ngay bước dán callback URL hoặc authorization code. Hoàn tất đổi
  code xong sẽ tạo kết nối, lưu qua Vault boundary hiện có và vào thẳng Chat.
  Luồng này không còn phụ thuộc vào event callback tự động có thể đến trước khi
  WebView kịp đăng ký listener.

### Quy ước phát hành
- Mọi tính năng hoàn tất phải có mục changelog trước khi merge vào `main`.
- Mỗi commit `main` cắt một patch release mới; bản cài macOS Intel và Apple
  Silicon được build trước, còn Windows/Linux chạy qua workflow thủ công.
  Release thành công được publish tự động thay vì để dạng draft.

## [1.0.1] — 2026-07-19

### Thêm mới
- **AI Router native.** Provider Core được đưa vào V Assistant để quản lý hơn
  100 vendor tại chỗ, không kết nối runtime sang 9router. Kết nối có thể dùng
  subscription OAuth/device flow hoặc API key theo adapter của từng vendor.
- **Vault-backed AI accounts.** Mỗi connection giữ một `credentialRef` opaque;
  token, refresh token và cookie được AI Router lấy từ Vault, không đưa qua
  agent/model hay hiển thị trong UI. Nhiều tài khoản cho cùng vendor được giữ
  riêng theo account label/email.
- **Packs cho model.** Người dùng có thể gom model đã kết nối thành pack,
  thiết lập fallback hoặc round-robin, chỉnh sửa/xoá pack, và ưu tiên pack ở
  đầu danh sách chọn model. Bộ chọn mở rộng hỗ trợ lọc theo account.
- **Local User.** Đăng nhập Gemini, GPT, Claude hoặc Grok lần đầu tự tạo Local
  User trên thiết bị. Tên hiển thị chỉnh sửa được và có logout xác nhận: gỡ
  connection tạo profile cùng credential Vault của nó, không ảnh hưởng vendor
  khác.
- **Vault UI cho AI credentials.** Hiển thị tên provider, account label/email,
  trạng thái và Vault reference; người dùng có thể sửa metadata mà không làm
  lộ bí mật.

### Thay đổi
- Settings chỉ hiển thị model từ provider/account đã kết nối thực sự. Trạng
  thái AI account của Local User không còn suy diễn từ toàn bộ vendor
  connections.
- Dropdown model hiển thị nguồn đầy đủ `provider · account`, giúp phân biệt
  cùng model giữa nhiều tài khoản.
- Bundle identifier desktop đổi thành `com.vuaai.assistant`.
- Release workflow chỉ chạy khi có push vào `main`; mỗi lần chạy tự tăng patch
  từ tag SemVer gần nhất, đồng bộ version vào package, lockfile, Tauri và Cargo.

### Sửa lỗi
- Provider bị quota/permission khi test sau OAuth không còn xoá kết quả đăng
  nhập hợp lệ; connection và credential vẫn được giữ, lỗi test được báo riêng.
- Sửa fallback khi vendor trả rate-limit và định tuyến lại vendor khả dụng.
- Sửa build macOS khi đọc Chrome Keychain cho Grok session capture.
- Sửa trạng thái `connected` của Local User để chỉ phản ánh tài khoản đã tạo
  profile, không phải tất cả AI Router connections.

### Phát hành
- GitHub Actions đã build thành công DMG `x86_64` và `aarch64` cho v1.0.1.
  Bản macOS hiện chưa được Developer ID code-sign/notarize.

## [1.0.0] — 2026-07-17

App giờ chạy engine agent **ngay trong ứng dụng** — cài, đăng nhập, dùng.
Không Docker, không engine tách rời, không cấu hình.

### Thêm mới
- **Agent thao tác qua Vault.** Vòng lặp tool-calling trong app cho phép agent
  chạy công cụ thật: `vault_list` (liệt kê thông tin đăng nhập đã lưu — chỉ tên
  và tên field, không bao giờ lộ giá trị bí mật) và `http_request` (thực hiện
  hành động như đăng bài blog hoặc gọi API). Bí mật được tham chiếu bằng
  placeholder `{{vault:Tên.field}}` và thay tại chỗ, nên mật khẩu/khóa không bao
  giờ lọt vào model. Đã kiểm chứng đầu-cuối (`scripts/tool-loop-check.mjs`).
- **Telegram 2 chiều trong app.** Dán token của @BotFather rồi nhắn cho bot; bot
  trả lời bằng chính trợ lý đó (provider + agent + công cụ Vault). Kênh đọc token
  từ Vault, long-poll Telegram, tự bật/tắt theo integration. Đổi provider/agent
  có hiệu lực ngay. Đã kiểm chứng (`scripts/telegram-check.mjs`).
- **Việc hẹn giờ chạy thật.** Mỗi phút kiểm tra một lần, chạy mọi task đến hạn
  qua trợ lý và giao kết quả vào chat và (nếu đã kết nối) Telegram. Nhận biết lịch
  hằng ngày / ngày trong tuần / thứ chỉ định / mỗi giờ / hằng tháng với giờ
  "at HH:MM". Đã kiểm chứng (`scripts/schedule-check.mjs`).
- **CI phủ toàn bộ** các mục trên, cộng logic đăng nhập trực tiếp
  (`scripts/login-check.mjs`): đổi code→key bằng PKCE (S256), định tuyến đúng
  model từng vendor, và tạo user local.
- **Vai trò cô lập, chuyển tức thì.** Knowledge và memory giờ tách theo từng vai
  trò: chọn Sales Expert thì có kiến thức của Sales; chuyển sang Marketing thì
  đổi sạch, không lẫn. Chuyển vai trò tức thì (thuần state, không khởi động lại).
  Đã kiểm chứng (`scripts/isolation-check.mjs`).
- **Bộ nhớ tự học (kiểu Hermes).** Sau mỗi lượt, vai trò tự suy ngẫm và lưu các
  sự thật bền vững về người dùng vào bộ nhớ riêng của mình (khử trùng lặp, có giới
  hạn); có công tắc trong Settings. Đã kiểm chứng (`scripts/self-improve-check.mjs`).
- **WASM sandbox chạy code (tùy chọn)** (feature Cargo `sandbox`, tắt mặc định để
  app nhẹ và khởi động tức thì). Code guest chạy không có host import, có trần bộ
  nhớ và ngân sách fuel — code chạy loạn hay độc hại đều bị chặn, không hại máy
  host. Đã kiểm chứng (`examples/sandbox_check`).
- **Connectors.** Một integration đã kết nối (GitHub, Notion, Slack, Discord,
  Telegram, …) trở thành plugin agent gọi theo tên; connector tự lấy credential
  từ Vault và tự áp đúng cơ chế xác thực của từng hệ thống. Token không bao giờ
  đi qua model. Đã kiểm chứng (`scripts/connector-check.mjs`).
- **Knowledge đọc tài liệu thật (RAG).** File thả vào được trích xuất thật — PDF
  (pdfjs), Word/Excel/PowerPoint (parse ZIP+XML gốc, không cần thư viện ngoài),
  text/Markdown/CSV/HTML — chia chunk và lập chỉ mục theo từng vai trò trong
  IndexedDB. Mỗi lượt chat truy xuất các đoạn khớp câu hỏi nhất và trả lời dựa
  trên đó, có trích nguồn. Lỗi hiện rõ trên UI (ví dụ PDF scan không có text,
  `.doc` cũ). Truy xuất theo từ khóa (tf-idf) — riêng tư, không gì rời khỏi máy.
  Đã kiểm chứng đầu-cuối với file docx/xlsx/pptx/pdf thật (`scripts/rag-check.mjs`).

### Thay đổi
- Engine giờ được mô tả là nhúng và luôn sẵn sàng; một NanoClaw host bên ngoài là
  phần gắn thêm nâng cao tùy chọn, không bắt buộc cho sử dụng thông thường.

### Đã biết / chưa tự động hóa
- Vòng OAuth redirect thật và round-trip qua openrouter.ai vẫn cần kiểm tra tay
  trên desktop thật (CI không có trình duyệt). Phần *logic* đăng nhập đã được phủ
  bởi `scripts/login-check.mjs`.
- Các mục nâng cao còn trong kế hoạch: OAuth integrations (Drive/Outlook/Calendar),
  bộ skill riêng theo vai trò, và MCP client.

## [0.1.0] — 2026-07-11

Bản cài đặt đầu tiên cho macOS, Windows và Linux.

### Thêm mới
- **Onboarding & đăng nhập:** luồng login-first với 1-click "Continue with
  ChatGPT / Claude / Gemini / OpenRouter" qua OpenRouter PKCE OAuth (không cần
  API key); API key có sẵn trong Advanced options. Lần đăng nhập đầu tự tạo user
  local từ tài khoản vendor.
- **AI providers:** chat streaming thật qua Anthropic, Google Gemini và các API
  tương thích OpenAI (OpenRouter / OpenAI / server nội bộ); đổi provider 1-click.
- **Credential Vault:** bí mật lưu trong OS keychain trên desktop; entry có field
  mặc định và field tùy chỉnh có kiểu (text, password, number, URL, email, date,
  datetime) kèm icon tương ứng.
- **Skills:** [Agent Skills](https://agentskills.io) chuẩn, dựng sẵn; cài skill từ
  URL; skill đang chạy điều hướng cuộc chat. Có catalog engine-skills của NanoClaw
  (channels/providers/capabilities).
- **Agents:** agent store cài được; Instructions, Soul và Memory riêng từng agent,
  tiêm vào system prompt.
- Các trang **Knowledge, Integrations, Scheduled, Settings**; cấu hình bot-token
  Telegram; giao diện responsive; logo thương hiệu và icon ứng dụng.
- **Vỏ desktop (Tauri):** loopback OAuth, Vault qua OS-keychain, runtime service;
  CI (frontend + Rust) và workflow phát hành tạo installer cho macOS (arm64/x64),
  Windows và Linux.

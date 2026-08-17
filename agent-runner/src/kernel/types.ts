/**
 * Kiểu nền của lớp plugin.
 *
 * Ý tưởng lấy từ DeepSeek Harness: **mọi thứ là plugin, không có lõi đặc quyền
 * để vá**. Nhưng dsh dựng trên Cordis — một framework DI đầy đủ, hợp với 456
 * nghìn dòng của họ. Runner của mình 6.583 dòng, nên ở đây tự dựng lớp mỏng:
 * lấy đúng ba kỷ luật đắt giá của họ mà không mang theo framework.
 *
 *   1. Đăng ký là *effect* — mỗi `register()` trả về hàm gỡ. Plugin gỡ ra là
 *      mọi thứ nó cắm vào cũng rút theo, không để lại rác.
 *   2. Sự kiện có kiểu — mở rộng bằng declaration merging, không dùng chuỗi tự do.
 *   3. Sai cấu hình thì nổ to ngay lúc nạp, không im lặng bỏ qua.
 *
 * Ràng buộc riêng của VuaAssistant: **cài là chạy**. Nên plugin được import
 * tĩnh từ một bản kê dựng sẵn, KHÔNG dò tìm ngoài đĩa lúc chạy. Đây không phải
 * tuỳ chọn thẩm mỹ: lỗi `Cannot find package 'undici'` từng làm bản cài chết
 * ngay khi khởi động, đúng vì thứ gì phân giải lúc chạy thì bản đóng gói không
 * bảo đảm được.
 */

/** Hàm gỡ một đăng ký. Gọi nhiều lần phải an toàn. */
export type Disposer = () => void;

/**
 * Bản đồ sự kiện dạng thông báo — nghe để biết, không sửa được luồng.
 *
 * Plugin mở rộng bằng declaration merging:
 * ```ts
 * declare module './types.js' {
 *   interface NotifyEvents { 'ten/su-kien': (payload: Kieu) => void }
 * }
 * ```
 */
export interface NotifyEvents {
  /** Runner đã nạp xong toàn bộ plugin và sắp vào vòng lặp. */
  'kernel/ready': () => void;
  /** Runner bắt đầu tắt; plugin nên dọn tài nguyên của mình. */
  'kernel/dispose': () => void;
}

/**
 * Bản đồ sự kiện dạng thác nước — nghe để *can thiệp* vào luồng.
 *
 * Listener nhận `(payload, next)` và **bắt buộc gọi `next()`** để nhường cho
 * lớp sau. Không gọi là chặn đứng chuỗi — đó là cách một plugin từ chối một
 * hành động. Trả về giá trị khác nghĩa là thay thế kết quả.
 */
export interface WaterfallEvents {
  // Các plugin bổ sung thành viên qua declaration merging.
  // Ví dụ đang dùng thật: 'tools/pre-execute' ở kernel/tools.ts.
}

/** Listener của thác nước: gọi `next()` để nhường, không gọi là chặn. */
export type WaterfallListener<Payload, Result> = (
  payload: Payload,
  next: () => Promise<Result>,
) => Promise<Result>;

/**
 * Các thành viên do chính kernel sở hữu.
 *
 * Tách riêng để `provide()` chỉ nhận khoá của *dịch vụ* — gắn đè lên `emit`
 * hay `effect` là hỏng kernel, nên chặn ngay ở tầng kiểu.
 */
export interface ContextCore {
  on<K extends keyof NotifyEvents>(event: K, listener: NotifyEvents[K]): Disposer;
  emit<K extends keyof NotifyEvents>(
    event: K,
    ...args: Parameters<NotifyEvents[K]>
  ): Promise<void>;
  intercept<K extends keyof WaterfallEvents>(
    event: K,
    listener: WaterfallEvents[K],
  ): Disposer;
  run<Payload, Result>(
    event: keyof WaterfallEvents,
    payload: Payload,
    base: () => Promise<Result>,
  ): Promise<Result>;
  effect(dispose: Disposer): Disposer;
  provide<K extends Exclude<keyof Context, keyof ContextCore>>(
    key: K,
    value: Context[K],
  ): Disposer;
  readonly pluginName: string;
}

/**
 * Ngữ cảnh dùng chung mà mọi plugin cắm vào.
 *
 * Các dịch vụ (`tools`, `prompt`, …) được gắn lên đây bằng declaration merging
 * từ chính plugin sở hữu chúng, nên kernel không cần biết trước có những gì.
 */
export interface Context extends ContextCore {
  // Dịch vụ do plugin gắn vào được khai thêm ở đây bằng declaration merging.
  // Ví dụ đang dùng thật: `tools` (kernel/tools.ts), `prompt` (kernel/prompt.ts).
}

/**
 * Một plugin.
 *
 * `setup` chạy đúng một lần lúc nạp. Trả về hàm gỡ nếu cần dọn thêm thứ mà
 * `ctx.effect()` không phủ hết.
 */
export interface Plugin {
  /** Tên duy nhất trong cả runner. Trùng tên là nổ ngay lúc nạp. */
  readonly name: string;
  /**
   * Tên các plugin phải nạp xong trước. Thiếu một cái là nổ ngay lúc nạp chứ
   * không im lặng bỏ qua — plugin chạy thiếu phụ thuộc sẽ hỏng ở chỗ khó tìm
   * hơn nhiều so với chỗ khai báo.
   */
  readonly dependencies?: readonly string[];
  setup(ctx: Context): void | Disposer | Promise<void | Disposer>;
}

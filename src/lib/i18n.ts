/**
 * Lightweight i18n internationalization module for Vua AI Assistant.
 * Supports Vietnamese (default) and English with zero external dependencies.
 */

export type Language = "vi" | "en";

export type Theme = "system" | "light" | "dark" | "gold" | "midnight";

export const translations = {
  vi: {
    app_title: "Vua AI Assistant",
    app_subtitle: "Trợ lý AI dành cho mọi người",
    home: "Trang chủ",
    chat: "Trò chuyện",
    sessions: "Cuộc trò chuyện",
    agents: "Trợ lý AI",
    skills: "Kỹ năng",
    knowledge: "Bộ tri thức",
    media: "Kho Media",
    vault: "Kho Bảo mật Vault",
    scheduled: "Lịch & Nhiệm vụ",
    integrations: "Tích hợp & Channels",
    settings: "Cài đặt hệ thống",
    settings_subtitle: "Quản lý mô hình AI, két mật mã Vault, ranh giới thư mục làm việc và cập nhật phiên bản.",

    // General & Appearance Settings
    self_improve_title: "Bộ nhớ Tự cải tiến (Self-improving memory)",
    self_improve_label: "Ghi nhớ ngữ cảnh tự động",
    self_improve_desc: "Mỗi Agent sẽ tự học và ghi nhớ các sự thật quan trọng từ đoạn chat để tối ưu phản hồi trong tương lai.",
    appearance_language_title: "Giao diện & Ngôn ngữ (Appearance & Language)",
    language: "Ngôn ngữ giao diện",
    language_desc: "Chọn ngôn ngữ hiển thị chính của ứng dụng",
    theme: "Chủ đề giao diện (Theme)",
    theme_desc: "Tùy chỉnh chế độ hiển thị Sáng / Tối",
    theme_system: "Theo hệ thống",
    theme_light: "Light Mode",
    theme_dark: "Dark Mode",
    theme_gold: "Gold Dark",
    theme_midnight: "Midnight",

    // Danger Zone
    danger_zone: "Vùng nguy hiểm (Danger zone)",
    reset_app_title: "Reset ứng dụng về trạng thái ban đầu",
    reset_app_desc: "Xóa sạch toàn bộ hội thoại, tài liệu tri thức, cấu hình Agent và đăng xuất tài khoản.",
    reset_now: "Reset ngay",

    // Workspace & Data Location
    workspace_title: "Vị trí Thư mục Dữ liệu & Lưu trữ (Data Workspace)",
    workspace_label: "Đường dẫn Thư mục Lưu trữ Dữ liệu Host",
    workspace_desc: "Chỉ định thư mục trên máy tính của bạn để VuaAssistant tự động lưu trữ tài liệu, lịch sử chat và bản sao lưu.",
    choose_folder: "Chọn thư mục",
    save_location: "Lưu vị trí",
    set_default: "Đặt lại mặc định",
    backup_restore_title: "Sao lưu & Khôi phục Dữ liệu (Backup & Restore)",
    export_backup: "Xuất dữ liệu Sao lưu (.json)",
    export_backup_desc: "Đóng gói toàn bộ lịch sử Chat, Kỹ năng, Lịch đăng bài thành tệp sao lưu",
    import_backup: "Khôi phục Dữ liệu từ Tệp Backup",
    import_backup_desc: "Tải tệp .json sao lưu lên để khôi phục toàn bộ cài đặt và lịch sử",
    choose_backup_file: "Chọn tệp Backup",

    // Model & Connected Accounts
    models_connected_title: "Mô hình AI & Tài khoản Kết nối (AI Models & Connected Accounts)",
    models_connected_desc: "Quản lý kết nối API Keys, OAuth vendor thông qua Local AI Router (Port 36360).",
    add_provider: "+ Thêm Provider Mới",
    close_provider_manager: "Đóng Quản lý Provider",
    active: "Active",
    inactive: "Tắt",
    not_configured: "Chưa cấu hình",
    configure: "Cấu hình",
    test_api: "Kiểm tra API",
    toggle_on: "Bật",
    toggle_off: "Tắt",
    delete: "Xóa",

    // Provider Manager Modal
    provider_manager_title: "Quản lý AI Vendor & Kết nối Trực tiếp",
    provider_manager_desc: "Thêm API Keys hoặc Đăng nhập OAuth để liên kết tài khoản Gemini, ChatGPT, Claude, Grok, DeepSeek...",
    search_provider: "Tìm Provider (OpenAI, Anthropic, Gemini...)",
    fast_oauth: "Đăng nhập Nhanh via OAuth (Subscription)",
    oauth_desc: "Ủy quyền liên kết tài khoản trực tiếp qua trình duyệt web mà không cần lấy API key thủ công.",
    login_with: "Đăng nhập",
    opening_browser: "Đăng mở trình duyệt...",
    manual_auth_url: "URL xác thực thủ công:",
    paste_callback_label: "Dán URL Callback / Redirect từ trình duyệt (nếu tự chuyển hướng về localhost:1420):",
    paste_callback_placeholder: "Dán link (e.g. http://localhost:1420/callback?code=...)",
    verifying: "Đang xác thực...",
    confirm_link: "Xác nhận Link",
    config_via_apikey: "Cấu hình qua API Key",
    enter_apikey_placeholder: "Nhập API Key...",
    save_key: "Lưu Key",

    // Software Updates
    software_update_title: "Cập nhật Ứng dụng (Software Update)",
    current_version: "Phiên bản hiện tại",
    has_update: "CÓ BẢN MỚI",
    latest: "Mới nhất",
    new_release_found: "Phát hiện bản phát hành mới từ Vua Ai (vuaai.net)!",
    checking_for_updates: "Hệ thống sẽ tự động kiểm tra phiên bản mới nhất từ Vua Ai (vuaai.net).",
    release_notes: "Nhật ký thay đổi (Release Notes):",
    check_for_update: "Kiểm tra bản mới",
    checking: "Đang kiểm tra...",
    auto_update_download: "⚡ Cập nhật tự động (Download DMG)",

    // Vault & Encryption
    vault_title: "Két mật mã Vault (Encrypted Vault & Credentials)",
    vault_subtitle: "Tất cả OAuth tokens, API Keys và mật khẩu truy cập của bạn được mã hóa an toàn ở cấp độ hệ thống thông qua Vault bảo mật của VuaAssistant.",
    aes_active: "Mã hóa AES-256 GCM + OS Keychain active.",
  },
  en: {
    app_title: "Vua AI Assistant",
    app_subtitle: "AI Assistant for Everyone",
    home: "Home",
    chat: "Chat",
    sessions: "Sessions",
    agents: "AI Agents",
    skills: "Skills",
    knowledge: "Knowledge Base",
    media: "Media Vault",
    vault: "Security Vault",
    scheduled: "Scheduled Tasks",
    integrations: "Integrations & Channels",
    settings: "System Settings",
    settings_subtitle: "Manage AI models, Vault security credentials, workspace directory boundaries, and software updates.",

    // General & Appearance Settings
    self_improve_title: "Self-Improving Memory",
    self_improve_label: "Automatic Context Recalling",
    self_improve_desc: "Each Agent automatically learns and recalls key facts from chat sessions to optimize future responses.",
    appearance_language_title: "Appearance & Language",
    language: "Interface Language",
    language_desc: "Select the primary display language for the application",
    theme: "UI Theme",
    theme_desc: "Customize Light / Dark display mode",
    theme_system: "System Default",
    theme_light: "Light Mode",
    theme_dark: "Dark Mode",
    theme_gold: "Gold Dark",
    theme_midnight: "Midnight",

    // Danger Zone
    danger_zone: "Danger Zone",
    reset_app_title: "Reset Application to Factory State",
    reset_app_desc: "Completely wipe all chat history, knowledge base documents, Agent configurations, and logout.",
    reset_now: "Reset Now",

    // Workspace & Data Location
    workspace_title: "Data Workspace & Storage Location",
    workspace_label: "Host Data Directory Path",
    workspace_desc: "Specify a directory on your computer where VuaAssistant automatically stores documents, chat logs, and backups.",
    choose_folder: "Choose Folder",
    save_location: "Save Location",
    set_default: "Set Default",
    backup_restore_title: "Backup & Restore Data",
    export_backup: "Export Backup File (.json)",
    export_backup_desc: "Package all Chat history, Skills, and Schedules into a single backup file",
    import_backup: "Restore Data from Backup File",
    import_backup_desc: "Upload a backup .json file to restore all settings and history",
    choose_backup_file: "Choose Backup File",

    // Model & Connected Accounts
    models_connected_title: "AI Models & Connected Accounts",
    models_connected_desc: "Manage API Keys, OAuth vendors via Local AI Router (Port 36360).",
    add_provider: "+ Add New Provider",
    close_provider_manager: "Close Provider Manager",
    active: "Active",
    inactive: "Disabled",
    not_configured: "Not Configured",
    configure: "Configure",
    test_api: "Test API",
    toggle_on: "Enable",
    toggle_off: "Disable",
    delete: "Delete",

    // Provider Manager Modal
    provider_manager_title: "Manage AI Vendors & Direct Connections",
    provider_manager_desc: "Add API Keys or OAuth Login to link Gemini, ChatGPT, Claude, Grok, DeepSeek accounts...",
    search_provider: "Search Provider (OpenAI, Anthropic, Gemini...)",
    fast_oauth: "Fast OAuth Sign-In (Subscription)",
    oauth_desc: "Authorize direct account connection via web browser without manual API key copying.",
    login_with: "Sign In With",
    opening_browser: "Opening browser...",
    manual_auth_url: "Manual Authorization URL:",
    paste_callback_label: "Paste Callback / Redirect URL from browser (if redirected to localhost:1420):",
    paste_callback_placeholder: "Paste link (e.g. http://localhost:1420/callback?code=...)",
    verifying: "Verifying...",
    confirm_link: "Verify Link",
    config_via_apikey: "Configure via API Key",
    enter_apikey_placeholder: "Enter API Key...",
    save_key: "Save Key",

    // Software Updates
    software_update_title: "Software Updates",
    current_version: "Current Version",
    has_update: "NEW VERSION AVAILABLE",
    latest: "Latest",
    new_release_found: "New release detected from Vua Ai (vuaai.net)!",
    checking_for_updates: "System automatically checks for the latest version on Vua Ai (vuaai.net).",
    release_notes: "Release Notes:",
    check_for_update: "Check for Updates",
    checking: "Checking...",
    auto_update_download: "⚡ Auto Update (Download DMG)",

    // Vault & Encryption
    vault_title: "Encrypted Vault & Credentials",
    vault_subtitle: "All your OAuth tokens, API Keys, and access credentials are key-protected and encrypted at system-level.",
    aes_active: "AES-256 GCM Encryption + OS Keychain active.",
  },
};

export function t(key: keyof typeof translations.vi, lang: Language = "vi"): string {
  return translations[lang]?.[key] ?? translations.vi[key] ?? key;
}

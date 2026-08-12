import { lazy, Suspense, useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { useApp, type View } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { Logo } from "@/components/Logo";
import { UpdateNotificationBanner } from "@/components/UpdateNotificationBanner";

const Onboarding = lazy(() => import("@/pages/Onboarding").then(({ Onboarding }) => ({ default: Onboarding })));
const Home = lazy(() => import("@/pages/Home").then(({ Home }) => ({ default: Home })));
const Chat = lazy(() => import("@/pages/Chat").then(({ Chat }) => ({ default: Chat })));
const Sessions = lazy(() => import("@/pages/Sessions").then(({ Sessions }) => ({ default: Sessions })));
const Agents = lazy(() => import("@/pages/Agents").then(({ Agents }) => ({ default: Agents })));
const Skills = lazy(() => import("@/pages/Skills").then(({ Skills }) => ({ default: Skills })));
const Knowledge = lazy(() => import("@/pages/Knowledge").then(({ Knowledge }) => ({ default: Knowledge })));
const MediaGallery = lazy(() => import("@/pages/MediaGallery").then(({ MediaGallery }) => ({ default: MediaGallery })));
const Vault = lazy(() => import("@/pages/Vault").then(({ Vault }) => ({ default: Vault })));
const Scheduled = lazy(() => import("@/pages/Scheduled").then(({ Scheduled }) => ({ default: Scheduled })));
const Integrations = lazy(() => import("@/pages/Integrations").then(({ Integrations }) => ({ default: Integrations })));
const Settings = lazy(() => import("@/pages/Settings").then(({ Settings }) => ({ default: Settings })));

const pages: Partial<Record<View, typeof Home>> = {
  home: Home,
  sessions: Sessions,
  agents: Agents,
  skills: Skills,
  knowledge: Knowledge,
  media: MediaGallery,
  vault: Vault,
  scheduled: Scheduled,
  integrations: Integrations,
  settings: Settings,
};

function PageFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-neutral-500">Đang tải…</div>;
}

function LazyApp({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export default function App() {
  const { onboarded, user, view } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  // Listen for global shortcuts from Tauri
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    import("@tauri-apps/api/event").then(({ listen }) => {
      // Rust tự xử lý ẩn/hiện cửa sổ và tải lại; chỉ những phím tắt cần giao
      // diện phản ứng mới gửi sự kiện xuống đây.
      listen("global-shortcut", (event) => {
        console.log("[Global Shortcut]", event.payload);
      });
    }).catch(() => {});
  }, []);

  if (!onboarded || !user) {
    return <LazyApp><Onboarding /></LazyApp>;
  }

  const Page = pages[view] || Home;

  return (
    <LazyApp>
      <div className="flex h-full flex-col md:flex-row">
        {/* Mobile top bar */}
        <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900/40 px-4 py-2.5 md:hidden">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="cursor-pointer rounded-lg p-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            <Menu className="size-5" />
          </button>
          <Logo className="size-7" />
          <span className="text-sm font-semibold">VuaAssistant</span>
        </header>

        {/* Desktop sidebar */}
        <Sidebar className="hidden md:flex" />

        {/* Mobile drawer */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 md:hidden animate-[drawer-in_200ms_ease-out]">
              <Sidebar
                className="bg-neutral-950"
                onNavigate={() => setMenuOpen(false)}
              />
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="absolute right-2 top-3 cursor-pointer rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800"
              >
                <X className="size-5" />
              </button>
            </div>
          </>
        )}

        <main className="min-h-0 min-w-0 flex-1 flex flex-col overflow-y-auto">
          <UpdateNotificationBanner />
          <div className="flex-1 min-h-0 relative h-full">
            {/* Chat page is kept permanently mounted so active streaming & background agent tasks never get killed when switching views */}
            <div className={view === "chat" ? "h-full" : "hidden"}>
              <Chat />
            </div>

            {/* Other views */}
            {view !== "chat" && (
              <div key={view} className="h-full animate-[page-in_150ms_ease-out]">
                <Page />
              </div>
            )}
          </div>
        </main>
      </div>
    </LazyApp>
  );
}

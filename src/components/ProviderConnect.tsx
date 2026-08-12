import { useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Loader2, LogIn, X } from "lucide-react";
import { getProvider, type ProviderId } from "@/lib/catalog";
import { DEFAULT_MODELS, type ProviderConfig, ROUTER_BASE_URL } from "@/runtime/providers";
import { needsManualCallback, openExternal, signIn } from "@/runtime/oauth";
import { loginConfig } from "@/runtime/providers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 " +
  "text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400/60";

/**
 * Connect dialog — login-first. Direct sign-in is the headline action;
 * the API-key path is tucked under "Advanced options" for people who
 * prefer a key or use a provider without OAuth yet. Local AI is the
 * exception: its "connection" is a server address, shown directly.
 */
export function ProviderConnect({
  provider,
  initial,
  hasSubscription = false,
  onSave,
  onClose,
  context = "settings",
}: {
  provider: ProviderId;
  initial?: ProviderConfig;
  hasSubscription?: boolean;
  onSave: (config: ProviderConfig | null) => void;
  onClose: () => void;
  context?: "onboarding" | "settings";
}) {
  const info = getProvider(provider);
  const isLocal = provider === "local";
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? (isLocal ? "http://localhost:11434/v1" : ""),
  );
  const [model, setModel] = useState(initial?.model ?? "");
  // Advanced (key) section: open by default when editing an existing
  // key-based connection or when the provider has no direct sign-in.
  const [advanced, setAdvanced] = useState(
    Boolean(initial?.apiKey) || (!info.oauth && !isLocal && !hasSubscription),
  );
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Manual fallback: when popup is blocked the UI shows auth URL + paste input
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null);
  const [manualCallbackUrl, setManualCallbackUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // If subscription is active, we don't require an API key to connect (it fallback to OpenRouter)
  const valid = isLocal
    ? baseUrl.trim() !== ""
    : (hasSubscription || apiKey.trim() !== "");

  const copyAuthUrl = () => {
    if (!manualAuthUrl) return;
    void navigator.clipboard.writeText(manualAuthUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitManualCallback = () => {
    try {
      const url = new URL(manualCallbackUrl.trim());
      const code = url.searchParams.get("code") || url.searchParams.get("token");
      const error = url.searchParams.get("error");
      if (error) { setLoginError(url.searchParams.get("error_description") || error); return; }
      if (!code) { setLoginError("No authorization code found in URL."); return; }
      // Let signIn complete via exchangeCode — inject code via BroadcastChannel
      const ch = new BroadcastChannel("vuaassistant_oauth");
      ch.postMessage({
        code,
        state: new URL(manualCallbackUrl.trim()).searchParams.get("state"),
        fullUrl: manualCallbackUrl.trim(),
      });
      ch.close();
    } catch {
      setLoginError("Invalid URL — please paste the full callback URL.");
    }
  };

  const login = async () => {
    setSigningIn(true);
    setLoginError(null);
    setManualAuthUrl(null);
    setManualCallbackUrl("");
    try {
      const result = await signIn(
        provider,
        context,
        needsManualCallback(provider)
          ? (url) => setManualAuthUrl(url)
          : undefined,
      );
      // Demo mode returns a credential in place; real mode navigated away.
      if (result) onSave(loginConfig(result.provider, result.apiKey, result));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoginError(msg);
    } finally {
      setSigningIn(false);
    }
  };

  const save = () => {
    onSave({
      apiKey: apiKey.trim() || undefined,
      baseUrl: isLocal ? baseUrl.trim() : (hasSubscription && !apiKey.trim() ? ROUTER_BASE_URL : undefined),
      model: model.trim() || undefined,
      connectionStatus: "connected",
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">Connect {info.name}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{info.tagline}</p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {info.hint && (
          <p className="mt-3 text-xs text-neutral-400">{info.hint}</p>
        )}

        {/* Local AI: the connection is a server address, no login. */}
        {isLocal ? (
          <div className="mt-4 flex flex-col gap-3">
            <label className="text-xs text-neutral-400">
              Server address
              <input
                className={`${inputClass} mt-1`}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
              />
            </label>
            <label className="text-xs text-neutral-400">
              Model (optional)
              <input
                className={`${inputClass} mt-1`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={DEFAULT_MODELS[provider]}
              />
            </label>
          </div>
        ) : info.oauth ? (
          <>
            {/* Global Subscription active alert */}
            {hasSubscription && (
              <div className="mt-4 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs text-gold-300">
                <div className="font-semibold flex items-center gap-1.5 text-gold-200">
                  <Check className="size-4 text-gold-400" /> Active Subscription
                </div>
                <p className="mt-1 text-neutral-400 leading-relaxed">
                  VuaAssistant has active central subscription. You can click <strong>Connect</strong> below to route this model through it, or sign in to this vendor.
                </p>
              </div>
            )}

            {/* OAuth Login button */}
            <Button
              className="mt-4 w-full"
              disabled={signingIn}
              onClick={() => void login()}
            >
              {signingIn ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  <LogIn className="size-4" /> {info.loginLabel}
                </>
              )}
            </Button>

            {/* Login error message */}
            {loginError && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                ⚠️ {loginError}
              </div>
            )}

            {/* Manual URL paste fallback (popup was blocked / closed early) */}
            {manualAuthUrl && (
              <div className="mt-3 rounded-xl border border-neutral-700 bg-neutral-950/60 p-3 flex flex-col gap-3">
                <p className="text-xs font-medium text-neutral-300">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <input readOnly value={manualAuthUrl}
                    className={`${inputClass} font-mono text-[10px] !py-1`} />
                  <Button variant="secondary" size="sm" onClick={copyAuthUrl}>
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </Button>
                </div>
                <p className="text-xs font-medium text-neutral-300">Step 2: Paste the callback URL here</p>
                <p className="text-[11px] text-neutral-500">
                  {needsManualCallback(provider)
                    ? `After you approve, the browser lands on a page that fails to load — that is expected. Copy the whole URL from its address bar (it contains ?code=…) and paste it below.`
                    : `After sign-in, copy the full URL from your browser's address bar.`}
                </p>
                <input
                  className={`${inputClass} font-mono text-[10px] !py-1`}
                  placeholder={
                    needsManualCallback(provider)
                      ? "http://localhost:443/callback?code=..."
                      : `${window.location.origin}/callback?code=...`
                  }
                  value={manualCallbackUrl}
                  onChange={(e) => setManualCallbackUrl(e.target.value)}
                />
                <Button onClick={submitManualCallback} disabled={!manualCallbackUrl.trim()}>
                  Connect
                </Button>
              </div>
            )}

            {/* Advanced: API key fallback. */}
            <button
              onClick={() => setAdvanced((a) => !a)}
              className="mt-4 flex w-full cursor-pointer items-center justify-between text-xs text-neutral-400 hover:text-neutral-200"
            >
              Advanced options
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  advanced && "rotate-180",
                )}
              />
            </button>
            {advanced && (
              <div className="mt-3 flex flex-col gap-3 border-t border-neutral-800 pt-3">
                <label className="text-xs text-neutral-400">
                  API key
                  <input
                    className={`${inputClass} mt-1`}
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Model (optional)
                  <input
                    className={`${inputClass} mt-1`}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={DEFAULT_MODELS[provider]}
                  />
                </label>
              </div>
            )}
          </>
        ) : hasSubscription ? (
          <>
            {/* Global Subscription is active: notify user they are covered. */}
            <div className="mt-4 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-xs text-gold-300">
              <div className="font-semibold flex items-center gap-1.5 text-gold-200">
                <Check className="size-4 text-gold-400" /> Active Subscription
              </div>
              <p className="mt-1 text-neutral-400 leading-relaxed">
                VuaAssistant will automatically route your requests through the central subscription. No API key required.
              </p>
            </div>

            {/* Advanced options for custom API key override. */}
            <button
              onClick={() => setAdvanced((a) => !a)}
              className="mt-4 flex w-full cursor-pointer items-center justify-between text-xs text-neutral-400 hover:text-neutral-200"
            >
              Custom API key (Advanced)
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  advanced && "rotate-180",
                )}
              />
            </button>
            {advanced && (
              <div className="mt-3 flex flex-col gap-3 border-t border-neutral-800 pt-3">
                <label className="text-xs text-neutral-400">
                  Override with your own {info.name} API key
                  <input
                    className={`${inputClass} mt-1`}
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                  />
                </label>
                <label className="text-xs text-neutral-400">
                  Model override (optional)
                  <input
                    className={`${inputClass} mt-1`}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={DEFAULT_MODELS[provider]}
                  />
                </label>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Direct to the vendor (no subscription, no oauth): open page → copy key → paste key. */}
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={() => info.keyUrl && void openExternal(info.keyUrl)}
            >
              <ExternalLink className="size-4" /> Open {info.name} to get your key
            </Button>
            <div className="mt-3 flex flex-col gap-3">
              <label className="text-xs text-neutral-400">
                Paste your {info.name} key
                <input
                  className={`${inputClass} mt-1`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste the key here"
                  autoFocus
                />
              </label>
              <label className="text-xs text-neutral-400">
                Model (optional)
                <input
                  className={`${inputClass} mt-1`}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={DEFAULT_MODELS[provider]}
                />
              </label>
            </div>
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          {initial ? (
            <Button variant="danger" size="sm" onClick={() => onSave(null)}>
              Disconnect
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {(isLocal || advanced || !info.oauth || hasSubscription) && (
              <Button size="sm" disabled={!valid} onClick={save}>
                {initial ? "Save" : "Connect"}
              </Button>
            )}
          </div>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">
          Your credentials are stored only on this device and sent only to{" "}
          {info.name}.
        </p>
      </div>
    </div>
  );
}

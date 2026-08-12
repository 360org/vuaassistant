/**
 * OAuth Callback Page
 *
 * Follows the same pattern as 9router:
 * - Receives ?code=, ?state=, ?error= from OAuth providers
 * - Relays data back to opener via postMessage (popup) + BroadcastChannel (same-tab fallback)
 * - Closes the popup automatically on success
 */
export function OAuthCallbackPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const token = params.get("token");
  const state = params.get("state");
  const error = params.get("error");
  const errorDescription = params.get("error_description");

  const callbackData = { code, token, state, error, errorDescription, fullUrl: window.location.href };

  // Method 1: postMessage to opener (popup mode)
  if (window.opener) {
    try {
      window.opener.postMessage({ type: "oauth_callback", data: callbackData }, window.location.origin);
    } catch (e) {
      console.warn("[callback] postMessage failed:", e);
    }
  }

  // Method 2: BroadcastChannel (same-origin tabs/iframes)
  try {
    const ch = new BroadcastChannel("vuaassistant_oauth");
    ch.postMessage(callbackData);
    ch.close();
  } catch (e) {
    console.warn("[callback] BroadcastChannel failed:", e);
  }

  // Method 3: localStorage event (extra fallback)
  try {
    localStorage.setItem(
      "vuaassistant_oauth_callback",
      JSON.stringify({ ...callbackData, timestamp: Date.now() }),
    );
  } catch {
    /* storage unavailable */
  }

  const hasResult = code || token || error;

  if (hasResult) {
    // Auto-close the popup. When a provider returned in the main tab, return
    // to the app instead so completeOAuthReturn can exchange the saved code.
    setTimeout(() => {
      if (window.opener) window.close();
    }, 1200);
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
      background: "#0a0a0a",
      color: "#fff",
    }}>
      <div style={{ textAlign: "center", padding: "2rem", maxWidth: 400 }}>
        {error ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Authorization Failed</h1>
            <p style={{ color: "#f87171", fontSize: 14 }}>{errorDescription || error}</p>
          </>
        ) : hasResult ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Authorization Successful</h1>
            <p style={{ color: "#a3a3a3", fontSize: 14 }}>
              {window.opener
                ? "This window will close automatically…"
                : "Đăng nhập thành công! Bạn có thể đóng tab này và quay lại ứng dụng VuaAssistant."}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Copy This URL</h1>
            <p style={{ color: "#a3a3a3", fontSize: 14, marginBottom: 12 }}>
              Copy the full URL from the address bar and paste it in the app.
            </p>
            <code style={{
              display: "block",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              wordBreak: "break-all",
              textAlign: "left",
              color: "#e5e5e5",
            }}>
              {window.location.href}
            </code>
          </>
        )}
      </div>
    </div>
  );
}

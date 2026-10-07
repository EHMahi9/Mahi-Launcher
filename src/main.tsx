import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("MAHI render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ padding: 32, color: "#f8fafc", background: "#050b14", minHeight: "100vh", fontFamily: "sans-serif" }}>
          <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>MAHI could not render this view</h1>
          <p style={{ color: "#94a3b8", marginBottom: "16px" }}>{this.state.error.message}</p>
          <div style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Reload MAHI
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                padding: "8px 16px",
                background: "rgba(255, 255, 255, 0.08)",
                color: "#cbd5e1",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Reset to Home
            </button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", color: "#fca5a5", fontSize: "12px", background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "6px" }}>{this.state.error.stack}</pre>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);

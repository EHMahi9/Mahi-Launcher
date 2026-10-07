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
          <h1>MAHI could not render this view</h1>
          <p>{this.state.error.message}</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "#fca5a5" }}>{this.state.error.stack}</pre>
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

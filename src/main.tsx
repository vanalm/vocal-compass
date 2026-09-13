import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiClient } from "./core";
import App from "./ui/App";
import { installErrorReporting } from "./ui/telemetry";
import "./styles.css";

// Production only: in development the console already shows every error, and no server may be running.
if (import.meta.env.PROD) {
  installErrorReporting(new ApiClient(), { release: import.meta.env.VITE_RELEASE || "dev" });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

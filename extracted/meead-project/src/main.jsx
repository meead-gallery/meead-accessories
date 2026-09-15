import React from "react";
import ReactDOM from "react-dom/client";
import "./shims/windowStorageShim.js";
import App from "./App.jsx";

// Build marker: price-save runtime fix 2026-09-15
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service Worker registration failed:", error);
    });
  });
}
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

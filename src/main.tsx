import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Serve Excalidraw's fonts/assets from our own bundle (public/), never a CDN.
// Required for the app to work offline and to satisfy the `default-src 'self'`
// CSP. Fonts are copied into public/ at build time (see public/fonts/).
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  "/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

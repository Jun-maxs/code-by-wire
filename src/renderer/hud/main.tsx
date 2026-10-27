import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./hud.css";
import { HudApp } from "./HudApp";

// One page, three windows, as in Agent HUD: the overlay (HudApp), and Agent HUD's own Settings and
// Statistics windows (`?window=settings|statistics`, opened by main/hud/windows.ts). All three share
// this origin's localStorage, so a change in Settings reaches the overlay through a storage event.
const AgentHudApp = lazy(() => import("./vendor/app/App"));
const window_ = new URLSearchParams(location.search).get("window");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window_ ? (
      <Suspense fallback={null}>
        <AgentHudApp productName="Code-by-wire HUD" />
      </Suspense>
    ) : (
      <HudApp />
    )}
  </React.StrictMode>,
);

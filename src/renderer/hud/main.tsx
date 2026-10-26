import React from "react";
import ReactDOM from "react-dom/client";
import "./hud.css";
import { HudApp } from "./HudApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HudApp />
  </React.StrictMode>,
);

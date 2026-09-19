import React from "react";
import ReactDOM from "react-dom/client";
import "@material-symbols/font-400/rounded.css";
import "dockview-react/dist/styles/dockview.css";
import "./core/theme/tokens.css";
import "./core/theme/macos.css";
import "./dock/dock.css";
import { App } from "./app";
import { installMacAppearance } from "./core/theme/macos";

installMacAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

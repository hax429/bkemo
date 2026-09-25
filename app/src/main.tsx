import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./styles/bkemo-theme.css";
import { startLiquidGlass } from "./lib/liquidGlass";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);

startLiquidGlass();

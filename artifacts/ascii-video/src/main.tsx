import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const mountEl =
  document.getElementById("ascii-tool-root") ||
  document.getElementById("root");

if (mountEl) {
  createRoot(mountEl).render(<App />);
}

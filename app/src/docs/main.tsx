import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design.css";
import { Docs } from "./Docs";
import { upgradeHashRoute } from "./route";

upgradeHashRoute();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Docs />
  </StrictMode>,
);

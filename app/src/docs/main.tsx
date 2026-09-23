import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../design.css";
import { Docs } from "./Docs";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Docs />
  </StrictMode>,
);

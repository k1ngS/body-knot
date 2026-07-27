import React from "react";
import { createRoot } from "react-dom/client";
import { BodyKnotShell } from "@/components/BodyKnotShell";
import "@/app/globals.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BodyKnotShell />
  </React.StrictMode>,
);

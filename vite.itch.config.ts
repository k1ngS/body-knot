import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const itchOutDir = resolve(__dirname, "out-itch");
const nextFaviconPath = resolve(__dirname, "src/app/favicon.ico");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "body-knot-copy-favicon",
      closeBundle() {
        copyFileSync(nextFaviconPath, resolve(itchOutDir, "favicon.ico"));
      },
    },
  ],
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  root: resolve(__dirname, "itch"),
  build: {
    emptyOutDir: true,
    outDir: itchOutDir,
  },
});

// The documentation screenshot harness: the real interface in a browser,
// against the in-memory API used by the interface tests. Never shipped.
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // The repository root, so Tailwind finds the interface's classes; the page
  // is /tests/screenshots/index.html.
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  },
  // web.json (the World English Bible, extracted by web-text.mjs) is served from here.
  publicDir: process.env.SCREENSHOT_DATA ?? false,
  server: { port: 1430, strictPort: true },
  clearScreen: false,
});

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    watch: {
      // ml/ is a Python project (ml/.venv alone is 30k+ files / 1.1GB) with
      // nothing the app needs HMR for; watching it saturates the fs watcher
      // and starves the dev server from ever responding to the first request.
      ignored: ["**/ml/**"],
    },
  },
});

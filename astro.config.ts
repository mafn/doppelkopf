// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://taegli.ch",
  trailingSlash: "always",
  redirects: {
    "/": "/doppelkopf/",
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["onnxruntime-web"],
    },
  },
  devToolbar: {
    enabled: false,
  },
});

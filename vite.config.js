import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// Cabeçalhos HTTP de segurança aplicados nos servidores locais (dev e preview)
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

// Plugin leve para copiar o banner Open Graph para o diretório de build sem duplicar arquivos no repo
function copyOpenGraphBanner() {
  return {
    name: "copy-og-banner",
    closeBundle() {
      const src = path.resolve(process.cwd(), "assets/og-banner.png");
      const destDir = path.resolve(process.cwd(), "dist/assets");
      const dest = path.join(destDir, "og-banner.png");
      if (fs.existsSync(src)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  server: {
    headers: securityHeaders,
  },
  preview: {
    headers: securityHeaders,
  },
  plugins: [copyOpenGraphBanner()],
});

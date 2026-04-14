import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReviewWindowData } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, "..", "web");

function escapeForInlineJson(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Read the raw web/index.html template. */
export function readTemplate(): string {
  return readFileSync(join(webDir, "index.html"), "utf8");
}

/** Read web/app.js source. */
export function readAppJs(): string {
  return readFileSync(join(webDir, "app.js"), "utf8");
}

/**
 * Build the full HTML for the Glimpse webview.
 * Inlines app.js and review data. No session token needed.
 */
export function buildGlimpseHtml(data: ReviewWindowData): string {
  const template = readTemplate();
  const appJs = readAppJs();
  const payload = escapeForInlineJson(JSON.stringify(data));
  return template
    .replace("__INLINE_DATA__", payload)
    .replaceAll("__SESSION_TOKEN__", "")
    .replace("<!--__SCRIPT_SRC__-->", "")
    .replace("__INLINE_JS__", appJs);
}

/**
 * Build the HTML for HTTP transport.
 * Data is inlined; app.js is served separately via script src; token is injected.
 */
export function buildHttpHtml(data: ReviewWindowData, token: string): string {
  const template = readTemplate();
  const payload = escapeForInlineJson(JSON.stringify(data));
  return template
    .replace("__INLINE_DATA__", payload)
    .replaceAll("__SESSION_TOKEN__", token)
    .replace(
      "<!--__SCRIPT_SRC__-->",
      `<script src="/app.js?token=${token}"></script>`,
    )
    .replace("__INLINE_JS__", "");
}

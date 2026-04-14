import { open, type GlimpseWindow } from "glimpseui";
import { buildGlimpseHtml } from "./html.js";
import type { ReviewHostMessage, ReviewWindowData, ReviewWindowMessage } from "./types.js";
import type { OnBrowserMessage, ReviewTransport } from "./transport.js";

function escapeForEval(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function createGlimpseTransport(
  data: ReviewWindowData,
  onMessage: OnBrowserMessage,
): ReviewTransport {
  const html = buildGlimpseHtml(data);
  const window: GlimpseWindow = open(html, {
    width: 1680,
    height: 1020,
    title: "pi review",
  });

  let resolveResult: ((v: ReviewWindowMessage | null) => void) | null = null;
  let rejectResult: ((e: Error) => void) | null = null;
  let settled = false;

  const resultPromise = new Promise<ReviewWindowMessage | null>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settle = (value: ReviewWindowMessage | null): void => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult?.(value);
  };

  const cleanup = (): void => {
    window.removeListener("message", handleMessage);
    window.removeListener("closed", handleClosed);
    window.removeListener("error", handleError);
  };

  const handleMessage = (raw: unknown): void => {
    const msg = raw as ReviewWindowMessage;
    onMessage(msg);
    if (msg.type === "submit" || msg.type === "cancel") {
      settle(msg);
    }
  };

  const handleClosed = (): void => settle(null);

  const handleError = (err: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult?.(err);
  };

  window.on("message", handleMessage);
  window.on("closed", handleClosed);
  window.on("error", handleError);

  return {
    url: null,
    port: 0,

    send(message: ReviewHostMessage): void {
      if (settled) return;
      const payload = escapeForEval(JSON.stringify(message));
      window.send(`window.__reviewReceive(${payload});`);
    },

    waitForResult: () => resultPromise,

    close(): void {
      settle(null);
      try {
        window.close();
      } catch {}
    },
  };
}

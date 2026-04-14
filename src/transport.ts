import type { ReviewHostMessage, ReviewWindowData, ReviewWindowMessage } from "./types.js";

/**
 * A running review session — either a native Glimpse window
 * or an HTTP + WebSocket server.
 */
export interface ReviewTransport {
  /** Human-readable URL for the user. Null for Glimpse (auto-opens). */
  readonly url: string | null;
  /** Bound port (HTTP) or 0 (Glimpse). */
  readonly port: number;
  /** Send a host → browser message. No-op if no client is connected. */
  send(message: ReviewHostMessage): void;
  /**
   * Resolves when the browser sends submit / cancel, the window closes,
   * or the session times out. Resolves null on close / timeout.
   */
  waitForResult(): Promise<ReviewWindowMessage | null>;
  /** Tear everything down. */
  close(): void;
}

/** Callback fired for every message the browser sends to the host. */
export type OnBrowserMessage = (message: ReviewWindowMessage) => void;

export type TransportMode = "glimpse" | "http";

/**
 * Determine which transport to use.
 *
 * Priority:
 *   1. Explicit env var  PI_DIFF_REVIEW_TRANSPORT = glimpse | http
 *   2. If `glimpseui` is importable → "glimpse"
 *   3. Fallback → "http"
 */
export async function detectTransport(): Promise<TransportMode> {
  const explicit = process.env.PI_DIFF_REVIEW_TRANSPORT;
  if (explicit === "glimpse" || explicit === "http") return explicit;

  try {
    await import("glimpseui");
    return "glimpse";
  } catch {
    return "http";
  }
}

/** Create the appropriate transport for the given mode. */
export async function createTransport(
  mode: TransportMode,
  data: ReviewWindowData,
  onMessage: OnBrowserMessage,
): Promise<ReviewTransport> {
  if (mode === "glimpse") {
    const { createGlimpseTransport } = await import("./transport-glimpse.js");
    return createGlimpseTransport(data, onMessage);
  }
  const { createHttpTransport } = await import("./transport-http.js");
  return createHttpTransport(data, onMessage);
}

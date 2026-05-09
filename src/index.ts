import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { getReviewWindowData, loadReviewFileContents } from "./git.js";
import { composeReviewPrompt } from "./prompt.js";
import {
  createTransport,
  detectTransport,
  type ReviewTransport,
  type TransportMode,
} from "./transport.js";
import type {
  ReviewFile,
  ReviewFileContents,
  ReviewHostMessage,
  ReviewRequestFilePayload,
  ReviewSubmitPayload,
  ReviewCancelPayload,
  ReviewWindowMessage,
} from "./types.js";

function isSubmitPayload(value: ReviewWindowMessage): value is ReviewSubmitPayload {
  return value.type === "submit";
}

function isCancelPayload(value: ReviewWindowMessage): value is ReviewCancelPayload {
  return value.type === "cancel";
}

function isRequestFilePayload(value: ReviewWindowMessage): value is ReviewRequestFilePayload {
  return value.type === "request-file";
}

type WaitingEditorResult = "escape" | "window-settled";

export default function (pi: ExtensionAPI) {
  let activeTransport: ReviewTransport | null = null;
  let activeWaitingUIDismiss: (() => void) | null = null;
  let resolvedTransportMode: TransportMode | null = null;

  function closeActiveTransport(): void {
    if (activeTransport == null) return;
    const t = activeTransport;
    activeTransport = null;
    try {
      t.close();
    } catch {}
  }

  function showWaitingUI(
    ctx: ExtensionCommandContext,
    transport: ReviewTransport,
  ): { promise: Promise<WaitingEditorResult>; dismiss: () => void } {
    let settled = false;
    let doneFn: ((result: WaitingEditorResult) => void) | null = null;
    let pendingResult: WaitingEditorResult | null = null;

    const finish = (result: WaitingEditorResult): void => {
      if (settled) return;
      settled = true;
      if (activeWaitingUIDismiss === dismiss) {
        activeWaitingUIDismiss = null;
      }
      if (doneFn != null) {
        doneFn(result);
      } else {
        pendingResult = result;
      }
    };

    const promise = ctx.ui.custom<WaitingEditorResult>((_tui, theme, _kb, done) => {
      doneFn = done;
      if (pendingResult != null) {
        const result = pendingResult;
        pendingResult = null;
        queueMicrotask(() => done(result));
      }

      return {
        render(width: number): string[] {
          const innerWidth = Math.max(24, width - 2);
          const borderTop = theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
          const borderBottom = theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);

          const lines =
            transport.url != null
              ? [
                  theme.fg("accent", theme.bold("Waiting for review")),
                  `Open review UI: ${transport.url}`,
                  "",
                  `ssh -L ${transport.port}:127.0.0.1:${transport.port} user@remote`,
                  "",
                  "Press Escape to cancel.",
                ]
              : [
                  theme.fg("accent", theme.bold("Waiting for review")),
                  "The native review window is open.",
                  "Press Escape to cancel and close the review window.",
                ];

          return [
            borderTop,
            ...lines.map(
              (line) =>
                `${theme.fg("border", "│")}${truncateToWidth(line, innerWidth, "...", true).padEnd(innerWidth, " ")}${theme.fg("border", "│")}`,
            ),
            borderBottom,
          ];
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.escape)) {
            finish("escape");
          }
        },
        invalidate(): void {},
      };
    });

    const dismiss = (): void => {
      finish("window-settled");
    };

    activeWaitingUIDismiss = dismiss;

    return { promise, dismiss };
  }

  async function reviewRepository(ctx: ExtensionCommandContext, baseRef?: string): Promise<void> {
    if (activeTransport != null) {
      ctx.ui.notify("A review session is already active.", "warning");
      return;
    }

    // Detect transport once and cache
    if (resolvedTransportMode == null) {
      resolvedTransportMode = await detectTransport();
    }

    const {
      repoRoot,
      files,
      baseRef: resolvedRef,
    } = await getReviewWindowData(pi, ctx.cwd, baseRef || "HEAD");

    if (files.length === 0) {
      ctx.ui.notify("No reviewable files found.", "info");
      return;
    }

    const fileMap = new Map(files.map((f) => [f.id, f]));
    const contentCache = new Map<string, Promise<ReviewFileContents>>();

    const loadContents = (
      file: ReviewFile,
      scope: ReviewRequestFilePayload["scope"],
    ): Promise<ReviewFileContents> => {
      const key = `${scope}:${file.id}`;
      const cached = contentCache.get(key);
      if (cached != null) return cached;
      const pending = loadReviewFileContents(pi, repoRoot, file, scope, resolvedRef);
      contentCache.set(key, pending);
      return pending;
    };

    const sendMessage = (msg: ReviewHostMessage): void => {
      activeTransport?.send(msg);
    };

    const handleRequestFile = async (msg: ReviewRequestFilePayload): Promise<void> => {
      const file = fileMap.get(msg.fileId);
      if (file == null) {
        sendMessage({
          type: "file-error",
          requestId: msg.requestId,
          fileId: msg.fileId,
          scope: msg.scope,
          message: "Unknown file requested.",
        });
        return;
      }

      try {
        const contents = await loadContents(file, msg.scope);
        sendMessage({
          type: "file-data",
          requestId: msg.requestId,
          fileId: msg.fileId,
          scope: msg.scope,
          originalContent: contents.originalContent,
          modifiedContent: contents.modifiedContent,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        sendMessage({
          type: "file-error",
          requestId: msg.requestId,
          fileId: msg.fileId,
          scope: msg.scope,
          message: messageText,
        });
      }
    };

    const onBrowserMessage = (message: ReviewWindowMessage): void => {
      if (isRequestFilePayload(message)) {
        void handleRequestFile(message);
      }
      // submit / cancel are handled via transport.waitForResult()
    };

    // Create the transport
    let transport: ReviewTransport;
    try {
      transport = await createTransport(
        resolvedTransportMode,
        { repoRoot, files, baseRef: resolvedRef },
        onBrowserMessage,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to start review: ${msg}`, "error");
      return;
    }

    activeTransport = transport;

    const modeLabel =
      transport.url != null
        ? `Review server started on port ${transport.port}.`
        : "Opened native review window.";
    ctx.ui.notify(modeLabel, "info");

    const waitingUI = showWaitingUI(ctx, transport);

    try {
      const result = await Promise.race([
        transport
          .waitForResult()
          .then((msg) => ({ type: "transport" as const, message: msg })),
        waitingUI.promise.then((reason) => ({ type: "ui" as const, reason })),
      ]);

      if (result.type === "ui" && result.reason === "escape") {
        closeActiveTransport();
        ctx.ui.notify("Review cancelled.", "info");
        return;
      }

      const message =
        result.type === "transport"
          ? result.message
          : await transport.waitForResult();

      waitingUI.dismiss();
      await waitingUI.promise;
      closeActiveTransport();

      if (message == null || isCancelPayload(message)) {
        ctx.ui.notify("Review cancelled.", "info");
        return;
      }

      if (isSubmitPayload(message)) {
        const prompt = composeReviewPrompt(files, message);
        ctx.ui.setEditorText(prompt);
        ctx.ui.notify("Inserted review feedback into the editor.", "info");
      }
    } catch (error) {
      activeWaitingUIDismiss?.();
      closeActiveTransport();
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Review failed: ${msg}`, "error");
    }
  }

  pi.registerCommand("diff-review", {
    description:
      "Open a review UI — optional arg: base ref (e.g. /diff-review main)",
    handler: async (args, ctx) => {
      const baseRef = args.trim() || undefined;
      await reviewRepository(ctx, baseRef);
    },
  });

  pi.on("session_shutdown", async () => {
    activeWaitingUIDismiss?.();
    closeActiveTransport();
  });
}

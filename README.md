# pi-diff-review

Diff review UI for pi, powered by Monaco. Automatically picks the best transport for your environment:

- **Desktop (Glimpse)** — opens a native review window via [Glimpse](https://github.com/hazat/glimpse)
- **Headless / SSH (HTTP)** — starts a local HTTP server with WebSocket transport, open in your browser

```
pi install git:https://github.com/JJGO/pi-diff-review
```

or to just try

```
pi -e git:github.com/JJGO/pi-diff-review
```

## What it does

Adds a `/diff-review` command to pi.

The command:

1. gathers reviewable files from the current git repository
2. auto-detects whether to open a native window or start an HTTP server
3. lets you switch between `git diff`, `last commit`, and `all files` scopes
4. shows a collapsible sidebar with fuzzy file search
5. shows git status markers in the sidebar for changed files and untracked files
6. lazy-loads file contents on demand as you switch files and scopes
7. lets you draft comments on the original side, modified side, or whole file
8. inserts the resulting feedback prompt into the pi editor when you submit

Optionally pass a base ref: `/diff-review main` to diff against a specific branch or commit.

## Transport auto-detection

| Condition | Transport |
|---|---|
| `PI_DIFF_REVIEW_TRANSPORT=glimpse` | Native Glimpse window |
| `PI_DIFF_REVIEW_TRANSPORT=http` | HTTP + WebSocket server |
| `glimpseui` is installed and importable | Native Glimpse window |
| Otherwise (headless, SSH, CI) | HTTP + WebSocket server |

## Requirements

- Node.js 20+
- `pi` installed
- Internet access for the Tailwind and Monaco CDNs used by the review UI
- **Desktop:** `glimpseui` npm package (installed automatically as optional dep)
- **Headless:** a browser to open the review URL (local or via SSH tunnel)

## Local usage (HTTP mode)

Run `/diff-review` inside pi. The terminal will print a URL like:

```
Open review UI: http://127.0.0.1:54321/?token=abc123...
```

Open that URL in your browser.

## Remote usage with SSH port forwarding

When running pi on a remote server, the review server binds to `127.0.0.1` and is not directly accessible. Use SSH port forwarding:

1. Run `/diff-review` in pi on the remote machine. Note the port number printed.

2. From your local machine, set up the port forward (using the actual port from step 1):

   ```
   ssh -L 8765:127.0.0.1:8765 user@remote
   ```

3. Open the printed URL in your local browser:

   ```
   http://127.0.0.1:8765/?token=...
   ```

## Configuration

Optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `PI_DIFF_REVIEW_TRANSPORT` | (auto) | Force `glimpse` or `http` transport |
| `PI_DIFF_REVIEW_HOST` | `127.0.0.1` | Bind address for the HTTP server |
| `PI_DIFF_REVIEW_PORT` | `0` (ephemeral) | Fixed port number |
| `PI_DIFF_REVIEW_SESSION_TIMEOUT_MS` | `1800000` (30 min) | Session inactivity timeout (HTTP mode) |
| `PI_DIFF_REVIEW_PUBLIC_URL` | (auto) | Override the printed URL base (for reverse proxies) |

## Windows notes

Glimpse now supports Windows. To build the native host during install you need:

- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

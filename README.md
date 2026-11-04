# CodeXavault V1 — Frontend Demo

A 13-page, browser-only CodeXavault website built with plain HTML, CSS and JavaScript. HTML, CSS and JavaScript remain separate files.

## Run locally

Use Python's static file server from this directory:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Pages

1. Landing — `index.html`
2. Login — `login.html`
3. Sign up — `signup.html`
4. Dashboard — `dashboard.html`
5. Create project — `project-new.html`
6. Code workspace — `editor.html`
7. Security center — `security.html`
8. Activity log — `activity.html`
9. Snapshots / version history — `snapshots.html`
10. GitHub integration preview — `github.html`
11. Secret scanner preview — `scanner.html`
12. Settings — `settings.html`
13. Shared project viewer — `viewer.html`

## Storage

Demo application data is stored in `localStorage` using the `cx_` prefix. The active demo session is browser-local. The terminal and editor share a virtual project filesystem. Browser storage is not a database, is not secure storage, is limited by browser quotas, and does not synchronize across users or devices. Do not put real passwords, tokens, API keys, or sensitive code into this demo.

## Terminal scope

- Multiple terminal tabs (up to 8), each with its own working directory and command history.
- Shared virtual project files between terminal commands and the editor.
- Built-in commands: `help`, `ls`, `pwd`, `cd`, `cat`, `mkdir`, `touch`, `rm`, `clear`, `history`.
- JavaScript execution in a Web Worker using `node <file>` or `javascript <file>`; `console.log` output is captured.
- JavaScript programs can request a line of input with `await readLine("Prompt: ")` and receive it through the terminal input row.
- JavaScript execution has a five-minute automatic time limit and can be stopped manually.
- Python execution uses Pyodide loaded from its CDN on first use; internet access is required for first load.
- Python `input()` / interactive stdin is not implemented in this version. Python runtime execution is not guaranteed to support every native package or OS feature.
- The editor Run button runs the currently selected `.js` or `.py` file in the terminal output.

This is a virtual project terminal, not a real OS shell. It cannot run arbitrary system commands, install native packages, launch native binaries, or provide C/C++/Java execution. A browser Worker is not a complete security sandbox; do not execute untrusted code in a browser profile containing sensitive data.

## Demo-only features

Authentication is a UI demo and does not verify credentials against a server. GitHub connection/import, secret scanning, security controls, share permissions, snapshots and collaboration are previews or browser-local simulations. There is no backend, database, GitHub OAuth, secure multi-user permission enforcement, or real-time collaboration.

## Quality checks performed

- All 13 HTML files contain a document title and body.
- No duplicate HTML IDs were found.
- All local script, stylesheet, favicon and page links resolve.
- `assets/js/app.js` and `assets/js/terminal.js` pass Node.js syntax checks.
- ZIP integrity is checked after packaging.

Browser-level execution testing may be restricted in automated environments. Test the terminal in your own browser before relying on it.

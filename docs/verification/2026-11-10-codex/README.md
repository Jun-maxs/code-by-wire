# Jun-Code 0.1.62 verification

Date: 2026-11-10. Codex CLI: 0.167.0.

- Full suite: 245 files passed; 2,327 tests passed, 5 skipped.
- After adding IPC/session-id coverage: 154 related tests passed. Final escaped Windows paths: 69 clipboard/store tests passed.
- Both TypeScript configurations passed; the node configuration passed again after adding IPC tests.
- Changed-file ESLint: no errors; one pre-existing unsafe-assignment warning in ipc.test.ts. Prettier applied to changed TypeScript and package.json.
- Production build passed.
- Isolated app-server config/read returned approval_policy=never, sandbox_mode=danger-full-access, model_context_window=900000. No model request was sent.
- An isolated Codex TUI accepted a bracketed paste of a quoted Windows PNG path containing spaces and Chinese characters, displaying [Image #1]. No message was submitted and the user clipboard was not changed.
- Full installed-app screenshot paste remains to be checked after installation. The fix uses Electron PNG export, followed by the tested Codex file-attachment path.

## Follow-up: GDI fallback (2026-11-11)

Root cause, reproduced with a standalone arboard 3.7 reader (the crate Codex uses): a valid
CF_DIBV5 with BI_BITFIELDS and an alpha mask, with no PNG on the clipboard, fails with
ConversionFailure. image 0.25 skips 12 bytes of masks after a V5 header, though clipboard DIBV5
keeps them inside the header; arboard also rewrites 32-bit BI_RGB + alpha headers to BI_BITFIELDS.
Electron 41 reads the same clipboard as an empty image, so the PNG export alone would paste
nothing. .NET/GDI reads it correctly.

- Added a Windows PowerShell (.NET, STA, hidden) PNG export used only when Electron reads empty.
  On the failing DIBV5 it produced a correct 400x300 PNG in about 0.3 s; a text-only clipboard
  returns null.
- Full suite: 245 files passed; 2,334 tests passed, 5 skipped. Typecheck, Prettier and ESLint
  (changed files) clean.

Tests run with CBW_CLAUDE_LAUNCHER cleared only in the test subprocess because this machine overrides that unrelated executable. No global Codex configuration or running Jun-Code session was changed.

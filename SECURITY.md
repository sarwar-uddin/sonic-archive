# Security

Sonic Archive is meant to run on your own computer, for you. It isn't
designed to be exposed to a network or shared between users.

## What it guards against

- **Harm to your music.** The music folder is only ever read: no file in it
  is modified, moved, renamed, deleted or retagged, and nothing is written
  inside it. All access goes through one read-only module, and a test fails
  if write calls or process spawning appear in the code that touches the
  library. The database and caches live in your XDG folders, never inside
  the music folder.
- **Other machines.** The server listens on `127.0.0.1` only, and this
  can't be configured. Requests whose `Host` isn't
  localhost/127.0.0.1/[::1] are refused, which stops DNS rebinding.
- **Other websites in your browser.** Only three requests change anything
  (choosing the music folder, rescanning, and the watch setting), and none
  can touch a music file. Each must:
  - come from the app's own origin;
  - carry a session token that only the app's page can read (no CORS
    headers are ever sent);
  - be JSON.

  This stops cross-site request forgery. Every other method is refused.
  API responses are served with a deny-all Content-Security-Policy, and the
  app's page with a strict one.
- **Path traversal.** Files are served by catalog id, never by a path from
  the request, and each stored path is re-checked to be inside the music
  folder (no `..`, no symlink leading out). The folder picker lists the
  names of one folder's subfolders, nothing more, and refuses a folder that
  is or contains your home directory.
- **Untrusted files in the collection.** Covers and scans are recognized by
  their bytes, so a tag or file can't smuggle SVG or HTML into what the app
  serves. Images, rip logs and CUE sheets are read with size caps.
- **Command injection.** ffmpeg (for playback conversion and dynamic range)
  is run without a shell, with exactly one local `file:` input and output
  to a pipe only.
- **Your data.** Nothing leaves your computer: no telemetry, no online
  lookups, no fonts or scripts from a CDN.

The full list of rules, each with how it is enforced, is in
[docs/safety.md](docs/safety.md).

## Reporting a problem

Please report security issues privately, using GitHub's
[private vulnerability reporting](https://github.com/sarwar-uddin/sonic-archive/security/advisories/new)
rather than a public issue.

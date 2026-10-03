# Security policy

## Reporting a vulnerability

Open a GitHub security advisory, or an issue if the problem is not sensitive.
Please include the file that triggers it where possible — malformed PDFs are
the most likely source of parsing bugs.

## Threat model

PDF Bench parses untrusted files, which is the risky part of its job. The
design assumes a malicious document will eventually find a parser bug, and
limits what that would buy an attacker:

- The parsing and rendering code runs in a sandboxed, context-isolated
  renderer with no Node.js access.
- That renderer has no filesystem access. It can ask the main process to show
  an Open or Save dialog; the user chooses the path. It cannot read or write
  anything else.
- Every outbound network request is blocked at the Electron session level, so
  there is no exfiltration path and no remote code to fetch.
- A strict Content-Security-Policy forbids remote and inline scripts, frames
  and objects. Navigation and pop-ups are refused.
- pdf.js runs its parser in a web worker with `isEvalSupported: false`.

What is explicitly out of scope: an already-compromised operating system, and
PDF permission flags, which the format leaves to the goodwill of the viewer
(see the README).

## Dependencies

`npm audit` runs in CI. The dependency list is deliberately short and every
component is listed in THIRD-PARTY.md.

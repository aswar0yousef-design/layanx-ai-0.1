# LayanX Security Model

## Trust boundary
LLMs, agents, skills, MCP tools, websites, files and generated code are untrusted by default.

## Enforcement path
Identity -> Project Isolation -> Mission -> Capability -> Skill/Tool Scope -> Permission -> Risk -> Approval -> Sentinel -> Budget -> Execution -> Verification -> Audit.

## Red-team coverage
The repository includes adversarial checks for cross-project access, capability scope bypass, approval scope bypass, secret persistence in memory, and Sentinel bypass attempts.

## Rule
Security controls must be enforced at runtime; tests and documentation are not substitutes for enforcement.

## Secret handling
Secrets must be resolved through a broker or external secret manager. Do not commit credentials, tokens or private keys to the repository.

## Filesystem sandbox
File tools (`files.read/list/stat/write`) apply three layers: (1) lexical containment and the shared Windows path guard (`src/platform/path-guard.ts`: NTFS alternate data streams, device names such as `CON`/`NUL`, `\\?\` prefixes, trailing dot/space, drive-relative paths); (2) the real path of the target, or of its nearest existing ancestor for new files, must stay inside the real project root, so a symlink or Windows junction cannot point outside; (3) writing through a symbolic link is refused. Regression: `tests/tool-sandbox-escape.spec.ts`.

Residual risk: a race between the real-path check and the write (TOCTOU) is possible if another local process swaps a directory for a link in between. The agent itself cannot create links through the file tools.

## Outbound network (SSRF)
`browser.read` and `http.read` go through `src/security/network-guard.ts`: only http/https, no credentials in URLs, no single-label / `.local` / `.internal` names, and every IP literal or DNS answer must be public. Blocked: loopback, `0.0.0.0/8`, RFC1918, CGNAT `100.64/10`, link-local and cloud metadata `169.254.169.254`, multicast/reserved, IPv6 loopback/ULA/link-local, IPv4-mapped/NAT64/6to4 forms. Redirects stay disabled.

Residual risk: DNS rebinding. The name is resolved for the check and again by the HTTP client. Closing this fully requires pinning the connection to the checked address (custom agent); tracked in `docs/ROADMAP.md`.

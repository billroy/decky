# MCP Server Security: State of the Ecosystem
*Research compiled March 12, 2026 — findings prioritized by security impact*

---

## Background

Anthropic introduced the Model Context Protocol (MCP) in November 2024 as a standard interface for AI assistants to connect with external tools, data sources, APIs, and file systems. Adoption has been explosive — over 1,000 new MCP servers were created in a single week at peak growth, and more than 5,200 unique open-source implementations now exist. However, security has consistently lagged behind adoption. The findings below are ranked by severity and real-world impact.

---

## Critical Severity

### 1. Exposed Servers — Unauthenticated Public Access (Feb 2026)
The most alarming recent finding: in February 2026, researchers scanned the public internet and found over 8,000 MCP servers visible with no authentication. Admin panels, debug endpoints, and API routes were wide open. Exposed data included full AI conversation histories, OpenAI API keys, database credentials, and internal service tokens. Root cause: default configurations that bind to `0.0.0.0:8080` on first deployment with no firewall prompting. The Clawdbot ecosystem — one of the most popular MCP-based agent tools — suffered a major incident related to this in January 2026.

### 2. NeighborJack — Network-Level RCE (June 2025)
Hundreds of MCP servers were found explicitly configured to bind to all network interfaces (`0.0.0.0`), exposing OS command injection paths to anyone on the same network or internet. This enabled complete host takeover with no credentials required.
- Reference: [NeighborJack: MCP Servers Hit by Vulnerability — Virtualization Review](https://virtualizationreview.com/articles/2025/06/25/mcp-servers-hit-by-neighborjack-vulnerability-and-more.aspx)

### 3. CVE-2025-6514 — RCE in `mcp-remote` npm Package (July 2025, CVSS 9.6)
The `mcp-remote` OAuth proxy library, downloaded over 437,000 times, allowed remote code execution by embedding OS commands in OAuth discovery fields. The client executed shell commands without sanitization. Affected Windows, macOS, and Linux. This is one of the first MCP supply-chain CVEs with a full public exploit path.

### 4. CVE-2025-59536 / CVE-2026-21852 — RCE via Claude Code Project Files
Critical vulnerabilities in Anthropic's Claude Code enabling attackers to execute arbitrary shell commands and steal Anthropic API keys when users open malicious git repositories containing crafted MCP configurations. Exploits hooks, MCP servers, and environment variables in combination.
- Reference: [Check Point Research](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)

---

## High Severity

### 5. Credential Mismanagement at Scale
Analysis of 5,200+ open-source implementations found that 88% require credentials — but 53% use long-lived static secrets (API keys, PATs) rather than scoped tokens. Only 8.5% use OAuth. 79% pass API keys via plain environment variables. This creates massive credential sprawl, particularly dangerous when combined with the exposed-server finding above.
- Reference: [Astrix State of MCP Server Security 2025](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/)

### 6. SQL Injection in Anthropic's Reference SQLite Server
Anthropic's own reference MCP implementation for SQLite concatenated user input directly into SQL queries without parameterization — a textbook SQL injection flaw. Because thousands of downstream servers forked this implementation, the vulnerability propagated widely before being patched.

### 7. Classic Code/Path Vulnerabilities in MCP Implementations
An analysis of 2,614 MCP implementations found:
- 82% use file system operations prone to path traversal (CWE-22)
- 67% use APIs vulnerable to code injection (CWE-94)
- 34% have command injection exposure (CWE-78)
- Reference: [Classic Vulnerabilities Meet AI Infrastructure — Endor Labs](https://www.endorlabs.com/learn/classic-vulnerabilities-meet-ai-infrastructure-why-mcp-needs-appsec)

---

## Medium Severity

### 8. Prompt Injection & Tool Poisoning
MCP tool descriptions and outputs flow directly into LLM context, creating a reliable prompt injection surface. The MCPTox benchmark found attack success rates as high as 72.8% against leading models — more capable models are often *more* vulnerable, as they follow embedded instructions more reliably. The "rug pull" variant is particularly insidious: a tool can mutate its own definition post-installation, turning a safe tool into a credential-stealer weeks later.
- Reference: [Palo Alto Unit 42 Research](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/)
- Reference: [Simon Willison's Analysis](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/)

### 9. Malicious & Unverified Servers in Registries
Attackers can publish MCP servers to unofficial registries using legitimate company branding. There is no universal vetting or code signing standard. Combined with "consent fatigue" attacks — where servers repeatedly trigger permission requests until users click through — this is an emerging social-engineering vector.

### 10. Shadow MCP Servers
The OWASP MCP Top 10 highlights "Shadow MCP" deployments: developer-spun instances running outside IT governance with default credentials and permissive configs, analogous to classic Shadow IT but with AI agent privileges attached.
- Reference: [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)

---

## Protocol & Standards Response

The MCP protocol specification update of June 2025 introduced mandatory Resource Indicators (RFC 8707) for MCP clients, scoping OAuth tokens to specific servers and preventing token relay attacks. The [2026 MCP Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) acknowledges enterprise needs around audit trails, SSO-integrated auth, and gateway behavior — but expects most hardening to arrive as extensions rather than core spec changes.

---

## Key Players in MCP Security Monitoring

### Research & Standards Bodies

| Organization | Focus | Link |
|---|---|---|
| **OWASP MCP Top 10** | Community standard mapping top 10 MCP-specific vulnerabilities; living document currently in beta | [owasp.org](https://owasp.org/www-project-mcp-top-10/) |
| **Invariant Labs / Snyk** | Pioneered MCP security research including tool poisoning disclosure; built MCP-Scan scanner (acquired by Snyk); offers live runtime monitoring, guardrails, PII detection, and prompt injection scanning | [invariantlabs.ai](https://invariantlabs.ai/) |
| **Cloud Security Alliance** | Open-source `mcpserver-audit` tool; companion tools for secure builds and runtime ops | [GitHub](https://github.com/ModelContextProtocol-Security/mcpserver-audit) |

### Security Platforms & Gateways

| Company | Offering | Link |
|---|---|---|
| **Astrix Security** | NHI and AI agent security since 2021; Agent Control Plane (ACP) provides unified inventory of MCP servers, AI agents, and NHIs with risk context; published the foundational State of MCP Server Security 2025 report | [astrix.security](https://astrix.security/) |
| **Lasso Security** | First open-source MCP Security Gateway acting as a proxy/orchestrator for all MCP interactions; Gartner 2024 Cool Vendor for AI Security | [lasso.security](https://www.lasso.security/) |
| **Operant AI** | MCP gateway + active security research; published *2026 Guide to Securing MCP* documenting "Shadow Escape" zero-click exploits | [operant.ai](https://www.operant.ai/) |
| **Pillar Security** | Unified discovery and runtime protection across MCP servers, LLMs, RAG workflows, and AI pipelines | [pillar.security](https://www.pillar.security/) |
| **Akto** | Claims industry's first MCP security platform with automatic discovery, testing, and real-time monitoring of AI orchestration layers | [akto.io](https://www.akto.io/) |
| **Cloudflare** | Zero Trust MCP Server Portals applying network security infrastructure to MCP access control and monitoring | [blog.cloudflare.com](https://blog.cloudflare.com/zero-trust-mcp-server-portals/) |
| **Trend Micro** | Active threat intelligence on exposed MCP servers; MCP threat coverage integrated into its broader platform | [trendmicro.com](https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data) |
| **Gopher Security** | Enterprise MCP gateway security with on-demand server and gateway hosting | [gopher.security](https://www.gopher.security/) |

---

## Core Problem Summary

The MCP ecosystem has a **"trust by default" design problem**: tool descriptions, external data, and server outputs all flow directly into LLM context with no mandatory sanitization layer — and most deployments compound this with static credentials, no authentication, and default-open network bindings.

---

## Sources

- [State of MCP Server Security 2025 — Astrix](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/)
- [8,000+ MCP Servers Exposed — Medium/cikce](https://cikce.medium.com/8-000-mcp-servers-exposed-the-agentic-ai-security-crisis-of-2026-e8cb45f09115)
- [NeighborJack: MCP Servers Hit by Vulnerability — Virtualization Review](https://virtualizationreview.com/articles/2025/06/25/mcp-servers-hit-by-neighborjack-vulnerability-and-more.aspx)
- [RCE and API Token Exfiltration via Claude Code (CVE-2025-59536) — Check Point Research](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- [Classic Vulnerabilities Meet AI Infrastructure — Endor Labs](https://www.endorlabs.com/learn/classic-vulnerabilities-meet-ai-infrastructure-why-mcp-needs-appsec)
- [MCP Prompt Injection Security Problems — Simon Willison](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/)
- [New Prompt Injection Attack Vectors Through MCP Sampling — Palo Alto Unit 42](https://unit42.paloaltonetworks.com/model-context-protocol-attack-vectors/)
- [MCP Security Vulnerabilities: Prompt Injection & Tool Poisoning 2026 — Practical DevSecOps](https://www.practical-devsecops.com/mcp-security-vulnerabilities/)
- [MCP Security Exposed — Palo Alto Networks Community](https://live.paloaltonetworks.com/t5/community-blogs/mcp-security-exposed-what-you-need-to-know-now/ba-p/1227143)
- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
- [MCP Spec Updates: Auth — Auth0/Okta](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [Introducing MCP-Scan — Invariant Labs](https://invariantlabs.ai/blog/introducing-mcp-scan)
- [MCP Security Notification: Tool Poisoning — Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
- [Snyk + Invariant Labs Partnership](https://labs.snyk.io/resources/snyk-labs-invariant-labs/)
- [Exposed MCP Servers: New AI Vulnerabilities — Bitsight](https://www.bitsight.com/blog/exposed-mcp-servers-reveal-new-ai-vulnerabilities)
- [MCP Security: Network-Exposed Servers Are Backdoors — Trend Micro](https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/mcp-security-network-exposed-servers-are-backdoors-to-your-private-data)
- [Zero Trust MCP Server Portals — Cloudflare](https://blog.cloudflare.com/zero-trust-mcp-server-portals/)
- [Lasso Open Source MCP Gateway Launch](https://www.lasso.security/resources/lasso-releases-first-open-source-security-gateway-for-mcp)
- [2026 MCP Roadmap — Anthropic Blog](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

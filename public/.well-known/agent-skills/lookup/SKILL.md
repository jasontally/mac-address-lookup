---
name: mac-lookup
description: Resolve a MAC address or OUI prefix to its registered organization using the MAC Address Lookup MCP server.
---

# MAC Address Lookup

Use the MCP server at https://mac.jasontally.com/mcp. It exposes one tool,
`lookup`, which takes a `mac` argument (full MAC or partial OUI/prefix) and
returns the matched prefix, block type, address count, organization name,
registration country, and a link to the record page.

No authentication required.

# MAC Address Lookup

Free, fast, **client-side MAC address vendor lookup**. Paste a full or partial MAC address (OUI prefix, MA-M, MA-S, IAB, or CID block) and instantly identify the organization behind it — everything runs in your browser with no backend and no tracking.

**[mac.jasontally.com](https://mac.jasontally.com)** _(coming soon)_

## Features

- **Full or partial lookup** — works with complete 48-bit addresses or just the leading hex digits (`00:1A:2B`, `001A2B3`, `001A2B3C4`)
- **Any format** — colons, hyphens, Cisco dots, spaces, or plain hex; input is normalized automatically
- **Complete IEEE registry coverage** — MA-L, MA-M, MA-S, IAB, and CID assignments, matched with longest-prefix precedence so small blocks resolve to the correct organization
- **Randomized MAC detection** — flags locally administered / privacy-randomized addresses instead of returning a misleading "unknown vendor"
- **VM & hypervisor detection** — recognizes VMware, VirtualBox, Hyper-V, KVM, Docker, Xen, and similar ranges
- **IEEE block details** — assignment type, block size, address range, registered country, and organization details
- **Format conversions** — see the address in every common notation
- **URL-driven lookups** — no pasting required: `mac.jasontally.com/001A2B` renders the result directly. Batch lookups work the same way.
- **Static & private** — the IEEE dataset loads once in the browser; all searching, processing, and presentation happen locally. Nothing is sent anywhere.
- **Dark mode** — follows your system preference by default, with a manual toggle
- **History, copy & share** — recent lookups are stored locally; results are copyable and permalinked

## URL-driven lookups

Navigate directly to a result — no form submission needed:

| URL | Result |
| --- | --- |
| `https://mac.jasontally.com/00:1A:2B:3C:4D:5E` | Full address lookup |
| `https://mac.jasontally.com/001A2B` | OUI / MA-L prefix lookup |
| `https://mac.jasontally.com/001A2B3` | MA-M prefix lookup |
| `https://mac.jasontally.com/001A2B3C4` | MA-S prefix lookup |
| `https://mac.jasontally.com/?q=001A2B,001A2B3` | Batch lookup |

The page consumes the address from the URL path or query string and displays the result without any manual input.

## SEO architecture

The site is fully static. A build step generates a pre-rendered HTML page for every registered IEEE prefix, so crawlers get real content without executing JavaScript. Once loaded, the page hydrates into the interactive tool and can resolve arbitrary full or partial addresses. Unmatched paths are served by a `404.html` fallback that runs the lookup client-side. Generated pages include canonical URLs, schema.org markup, `sitemap.xml`, and `robots.txt`.

## Data sources

- IEEE Registration Authority — MA-L, MA-M, MA-S, IAB, and CID CSV registries
- [Wireshark manufacturer database](https://gitlab.com/wireshark/wireshark/-/blob/master/manuf) — supplementary vendor info

## Tech stack

- Static HTML/CSS/JavaScript — no backend, no build server required at runtime
- IEEE dataset bundled for local search in the browser
- Pre-rendered per-prefix pages generated at build time for SEO
- Designed for GitHub Pages (custom domain: `mac.jasontally.com`)

## Status

Early development. Roadmap:

- [ ] IEEE registry ingestion + normalization pipeline
- [ ] Client-side lookup engine (longest-prefix match, bit analysis)
- [ ] Address-type + randomization detection
- [ ] VM/hypervisor dictionary
- [ ] Static page generator + sitemap
- [ ] URL/batch deep-link handling
- [ ] FAQ & explainer content
- [ ] History, copy/share, dark mode

## License

[MIT](LICENSE)

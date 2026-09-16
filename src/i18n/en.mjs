/** English UI strings — source of truth for all locales. */

export const en = {
  // Navigation
  'nav.brand': 'MAC Address Lookup',
  'nav.help': 'Help and documentation',
  'nav.helpTitle': 'Help and documentation',
  'nav.theme': 'Toggle theme',

  // Lookup form
  'lookup.label': 'MAC address or OUI prefix',
  'lookup.placeholder': 'MAC address, prefix, vendor, or paste text',
  'lookup.submit': 'Look up',

  // Examples
  'examples.label': 'Try:',
  'examples.random': 'Random',

  // Status
  'status.loadingRegistry': 'Loading registry…',

  // Batch
  'batch.title': 'Batch lookup',
  'batch.description':
    'Paste MAC addresses or CLI output — up to 250 addresses, commas, spaces, and new lines all work.',
  'batch.label': 'MAC addresses',
  'batch.placeholder': '00:1B:21:3C:4D:5E\narp -a output\nFA:CA:DE:00:00:01',
  'batch.submit': 'Look up addresses',
  'batch.exportCsv': 'Download CSV',
  'batch.exportJson': 'Copy JSON',

  // History
  'history.title': 'Recent lookups',
  'history.clear': 'Clear history',
  'history.noVendor': 'No registered vendor',

  // Result
  'result.eyebrow': 'Vendor',
  'result.loading': 'Loading vendor data…',
  'result.unknownOrg': 'Unknown organization',
  'result.assignment': '{type} assignment',
  'result.longestMatch': 'Longest prefix match on the first {bits} bits',
  'result.matchedPrefix': 'Matched prefix',
  'result.match': 'Match',
  'result.addressRange': 'Address range',
  'result.addressesInBlock': 'Addresses in block',
  'result.country': 'Country',
  'result.orgAddress': 'Organization address',
  'result.firstRegistered': 'First registered',
  'result.formats': 'Formats',
  'result.prefixLineage': 'Prefix lineage',
  'result.firstObserved': 'First observed',

  // Bits
  'bits.unicast': 'Unicast',
  'bits.multicast': 'Multicast (I/G bit set)',
  'bits.locallyAdministered': 'Locally administered (U/L bit set)',
  'bits.universallyAdministered': 'Universally administered (U/L bit clear)',
  'bits.broadcast': 'Broadcast address',
  'bits.allZeros': 'All-zero address',

  // Randomization
  'randomize.likelyTitle': 'Likely randomized or locally administered',
  'randomize.notesTitle': 'Address notes',
  'randomize.vmPrefix': 'Matches the {name} virtual machine prefix',
  'randomize.broadcast': 'Broadcast address, not a device address',
  'randomize.allZeros': 'All-zero address, not a device address',
  'randomize.localUnregistered':
    'Locally administered bit is set and the prefix is not registered to any vendor',
  'randomize.localPrivate':
    'Matches a privately registered block; locally administered addresses are not tied to hardware',
  'randomize.localRegistered':
    'Locally administered bit is set, which is unexpected for vendor-assigned hardware',
  'randomize.notRegistered':
    'Not registered to a vendor; a globally administered address can still be spoofed',

  // Theme
  'theme.toDark': 'Switch to dark theme',
  'theme.toLight': 'Switch to light theme',

  // Badges
  'badge.private': 'Private registration',
  'badge.vm': 'Virtual machine: {name}',
  'badge.randomized': 'Likely randomized',
  'badge.subdivided': 'OUI subdivided — vendor lookup does not apply',

  // Vendor portfolio
  'portfolio.label': 'Vendor portfolio: {blocks} · {addresses}',
  'portfolio.viewAll': 'View all prefixes',

  // Related prefixes (pre-rendered pages)
  'related.sameOrg': 'More blocks from',
  'related.adjacent': 'Adjacent prefixes',
  'related.cohort': 'Registered the same year',

  // Lineage
  'lineage.note':
    'This prefix has changed hands. Dates are when each change was first observed in public registration data (runZero mac-tracker).',
  'lineage.unknown': 'Unknown organization',

  // None (unregistered)
  'none.eyebrow': 'No vendor match',
  'none.title': 'Unregistered prefix',
  'none.description':
    'No IEEE registration matches this prefix. That usually means the address is locally administered — randomized for privacy, assigned by a virtual machine, or set manually.',

  // Formats
  'format.plain': 'Plain hex',
  'format.colon': 'Colon-separated',
  'format.hyphen': 'Hyphen-separated',
  'format.cisco': 'Cisco dot notation',
  'format.eui64': 'EUI-64',
  'format.ipv6': 'IPv6 link-local',
  'format.copy': 'Copy {label}',
  'format.copied': 'Copied',
  'format.copyFailed': 'Copy failed',
  'format.copyMac': 'Copy MAC address',

  // Tables
  'table.prefix': 'Prefix',
  'table.block': 'Block',
  'table.org': 'Organization',
  'table.addresses': 'Addresses',
  'table.blocks': 'Blocks',
  'table.match': 'Match',
  'table.input': 'Input',
  'table.result': 'Result',
  'table.flags': 'Flags',

  // Reasons
  'reason.vendor': 'Vendor',
  'reason.former': 'Former owner',
  'reason.country': 'Country',
  'reason.registry': 'Block type',
  'reason.prefix': 'Prefix',
  'reason.registered': 'Registration year',

  // Batch summary
  'summary.address': '{count} address',
  'summary.addresses': '{count} addresses',
  'summary.randomized': '{count} randomized',
  'summary.hypervisor': '{count} virtual machine',
  'summary.unregistered': '{count} unregistered',
  'summary.invalid': '{count} invalid',
  'summary.partial': '{count} partial',

  // Partial
  'partial.matching': '{count} matching prefix',
  'partial.matchingPlural': '{count} matching prefixes',
  'partial.note.start': 'Prefixes beginning with {prefix}',
  'partial.note.cap': ', showing the first {shown}',
  'partial.note.end': '. Select a prefix for full details.',
  'partial.showMore': 'Show more',

  // Search
  'search.matching': '{count} matching prefix',
  'search.matchingPlural': '{count} matching prefixes',
  'search.noMatch': 'No matching prefixes',
  'search.resultsFor': 'Results for “{query}”',
  'search.description':
    'Searches vendors, former owners, countries, registries, prefixes, and registration years.',
  'search.showing': 'Showing the first {shown}',

  // Batch result labels
  'batch.lookups': '{count} lookup',
  'batch.lookupsPlural': '{count} lookups',
  'batch.unregistered': 'Unregistered prefix',
  'batch.matchingPrefixes': '{count} matching prefixes',
  'batch.matched': '{count} matched a registered vendor.',
  'batch.extracted': 'Extracted from pasted text; non-address content was ignored.',

  // Status messages
  'status.addressExtracted': '{count} address extracted from pasted text.',
  'status.addressesExtracted': '{count} addresses extracted from pasted text.',
  'status.addressLookedUp': '{count} address looked up.',
  'status.addressesLookedUp': '{count} addresses looked up.',
  'status.limited': 'Limited to the first {max} of {total} addresses.',

  // Invalid
  'invalid.banner': 'That does not look like a MAC address',
  'invalid.empty': 'Enter a MAC address, at least one hex character, a vendor name, or paste some text.',
  'invalid.chars': 'Use hex characters only (0–9, A–F), with optional colons, hyphens, dots, or spaces.',
  'invalid.tooLong': 'A MAC address has at most 12 hex characters.',
  'invalid.default': 'That input could not be parsed as a MAC address.',

  // Data error
  'dataError.title': 'Could not load the registry data',
  'dataError.connection': 'Check your connection and try again.',
  'dataError.retry': 'Retry',

  // Help page
  'help.title': 'Help & documentation',
  'help.breadcrumb': 'Help',
  'help.whatThisTells': 'What this tool tells you',
  'help.howItWorks': 'How MAC address lookup works',
  'help.blockTypes': 'MAC address block types',
  'help.findYourMac': 'How to find your own MAC address',
  'help.faq': 'Frequently asked questions',
  'help.dataSources': 'Data sources and accuracy',

  // Block-type table
  'table.registry': 'Registry',
  'table.prefixLength': 'Prefix length',
  'table.addressesPerBlock': 'Addresses per block',
  'table.typicalUse': 'Typical use',

  // Noscript
  'noscript.title': 'JavaScript required',
  'noscript.body': 'The lookup runs entirely in your browser and needs JavaScript enabled.',

  // Footer
  'footer.dataNote':
    'All lookups run in your browser — the addresses you look up are never sent to a server.',
  'footer.help': 'Help & documentation',
  'footer.source': 'Source on GitHub',
  'footer.recent': 'Latest OUIs',

  // Recent page
  'recent.title': 'Latest OUIs',

  // Skip link
  'a11y.skip': 'Skip to content',
  'a11y.language': 'Language',
  'a11y.breadcrumb': 'Breadcrumb',

  // Pre-rendered prefix pages (client-side swap; HTML stays English for crawlers)
  'prerender.lede':
    '{prefix} is a {bits}-bit {blockType} MAC address block registered to {org}.',
  'prerender.ledeCountry':
    '{prefix} is a {bits}-bit {blockType} MAC address block registered to {org} in {country}.',
  'footer.dataSources': 'Data: IEEE Registration Authority registries; historical changes from',
  'footer.license': '(MIT).',
  'footer.bundled': 'Bundled software:',
  'footer.refreshed': 'Data refreshed',
  'footer.refreshPlaceholder': 'on the latest deploy',

  // Detail labels
  'detail.match': 'Match',
  'detail.matchedPrefix': 'Matched prefix',
  'detail.addressRange': 'Address range',
  'detail.addressesInBlock': 'Addresses in block',
  'detail.country': 'Country',
  'detail.orgAddress': 'Organization address',
  'detail.firstRegistered': 'First registered',
};

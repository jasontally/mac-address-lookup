/** Hypervisor detection and randomized-address classification. */

/** Known virtual-machine prefixes; longer prefixes win. Docker's is 4 hex. */
const HYPERVISOR_PREFIXES = [
  { prefix: '000569', id: 'vmware', name: 'VMware' },
  { prefix: '000C29', id: 'vmware', name: 'VMware' },
  { prefix: '001C14', id: 'vmware', name: 'VMware' },
  { prefix: '005056', id: 'vmware', name: 'VMware' },
  { prefix: '080027', id: 'virtualbox', name: 'VirtualBox' },
  { prefix: '0A0027', id: 'virtualbox', name: 'VirtualBox (host-only)' },
  { prefix: '00155D', id: 'hyperv', name: 'Microsoft Hyper-V' },
  { prefix: '0003FF', id: 'virtualpc', name: 'Microsoft Virtual PC' },
  { prefix: '001C42', id: 'parallels', name: 'Parallels' },
  { prefix: '00163E', id: 'xen', name: 'Xen' },
  { prefix: '525400', id: 'qemu', name: 'QEMU/KVM' },
  { prefix: '0242', id: 'docker', name: 'Docker container' },
].sort((a, b) => b.prefix.length - a.prefix.length);

/** Detect a well-known hypervisor prefix, or return null. */
export function detectHypervisor(hex) {
  const upper = hex.toUpperCase();
  for (const entry of HYPERVISOR_PREFIXES) {
    if (upper.length >= entry.prefix.length && upper.startsWith(entry.prefix)) {
      return { id: entry.id, name: entry.name, prefix: entry.prefix };
    }
  }
  return null;
}

/**
 * Decide whether an address is likely randomized/private.
 * The locally administered bit is the strongest signal; registered vendor
 * blocks are never flagged, and known hypervisor prefixes are excluded.
 */
export function classifyRandomization({ bits, match, hypervisor }) {
  if (hypervisor) {
    return {
      likely: false,
      confidence: 'none',
      reasons: [`Matches the ${hypervisor.name} virtual machine prefix`],
    };
  }
  if (!bits) return { likely: false, confidence: 'none', reasons: [] };
  if (bits.broadcast) {
    return { likely: false, confidence: 'none', reasons: ['Broadcast address, not a device address'] };
  }
  if (bits.allZeros) {
    return { likely: false, confidence: 'none', reasons: ['All-zero address, not a device address'] };
  }
  if (bits.locallyAdministered) {
    if (!match) {
      return {
        likely: true,
        confidence: 'high',
        reasons: [
          'Locally administered bit is set and the prefix is not registered to any vendor',
        ],
      };
    }
    if (match.isPrivate) {
      return {
        likely: true,
        confidence: 'medium',
        reasons: [
          'Matches a privately registered block; locally administered addresses are not tied to hardware',
        ],
      };
    }
    return {
      likely: true,
      confidence: 'low',
      reasons: ['Locally administered bit is set, which is unexpected for vendor-assigned hardware'],
    };
  }
  if (!match) {
    return {
      likely: false,
      confidence: 'none',
      reasons: ['Not registered to a vendor; a globally administered address can still be spoofed'],
    };
  }
  return { likely: false, confidence: 'none', reasons: [] };
}

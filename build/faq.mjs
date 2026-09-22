/**
 * FAQ content, rendered into both the visible home page and FAQPage
 * structured data so the two can never drift.
 */

import { escapeHtml } from './page-template.mjs';

export const FAQ = [
  {
    question: 'Why does my MAC address show no vendor?',
    answer:
      'Phones, tablets, and laptops often randomize their Wi-Fi MAC address per network. Randomized addresses set the locally administered bit and deliberately carry no manufacturer information, so no vendor can be resolved. Look up the hardware address from the device settings instead.',
  },
  {
    question: 'What is an OUI?',
    answer:
      'The Organizationally Unique Identifier is the first three bytes (24 bits) of a MAC address. The IEEE Registration Authority assigns each OUI to one organization, which is why the prefix identifies the manufacturer. Modern registries also contain smaller MA-M (28-bit) and MA-S (36-bit) blocks.',
  },
  {
    question: 'What do MA-L, MA-M, MA-S, IAB, and CID mean?',
    answer:
      'They are the IEEE assignment registries. MA-L is the classic 24-bit OUI with 16,777,216 addresses per block, MA-M is a 28-bit block with 1,048,576 addresses, MA-S and IAB are 36-bit blocks with 4,096 addresses each, and CID is a 24-bit company identifier that is not used for network interfaces.',
  },
  {
    question: 'Why does a MAC address show a company that no longer exists?',
    answer:
      'MAC prefixes are registered once and are rarely reassigned when a company is acquired or renamed. The hardware keeps its original prefix forever, so the current registry entry may show the acquiring company. For example, Tekelec blocks now show Oracle. Prefix lineage on each result shows when those changes were observed.',
  },
  {
    question: 'What is prefix lineage?',
    answer:
      'When a registered prefix changes hands or the organization name changes, this site shows a timeline of the organizations associated with that prefix and the dates the changes were first observed in public registration data. Lineage is shown only for the exact prefix, never inherited from a parent or child block.',
  },
  {
    question: 'Can a MAC address be spoofed?',
    answer:
      'Yes. Operating systems and network tools can set any MAC address, including one that belongs to a registered vendor block. A lookup tells you which organization registered the prefix, not which device actually sent the traffic.',
  },
  {
    question: 'What is a locally administered address?',
    answer:
      'The second-least-significant bit of the first octet distinguishes universally administered addresses (assigned by the IEEE to a vendor) from locally administered addresses (set by software). Randomized privacy addresses, virtual machines, and manual assignments are all locally administered.',
  },
  {
    question: 'Is this lookup private?',
    answer:
      'Yes. The IEEE dataset is downloaded once and every lookup runs in your browser: the addresses you type are never sent to a server, and the app sets no cookies and does no tracking. The site is hosted on Cloudflare, which collects privacy-first, aggregate web analytics that use no cookies or client-side state and do not fingerprint individuals.',
  },
  {
    question: 'Does the vendor match identify the exact device?',
    answer:
      'No. The prefix identifies the organization that registered the block, not a model or serial number. Many vendors use dozens or hundreds of prefixes, and contract manufacturers build devices for other brands.',
  },
  {
    question: 'How do I find my own MAC address?',
    answer:
      'On Windows, run "getmac /v" or open Settings, then Network and Hardware properties. On macOS, open System Settings, Network, Details, or run "ifconfig en0 | grep ether". On iPhone and Android, open the Wi-Fi network details; the private Wi-Fi address shown there is randomized.',
  },
];

export function renderFaqList() {
  return FAQ.map(
    ({ question, answer }) =>
      `          <details class="disclosure">\n` +
      `            <summary>${escapeHtml(question)}</summary>\n` +
      `            <div class="disclosure-body">\n` +
      `              <p>${escapeHtml(answer)}</p>\n` +
      `            </div>\n` +
      `          </details>`,
  ).join('\n');
}

export function renderFaqSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

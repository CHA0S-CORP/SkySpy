import React from 'react';
import { ExternalLink } from 'lucide-react';

const LINK_CONFIG = [
  {
    id: 'flightaware',
    label: 'FlightAware',
    getUrl: (hex, callsign) => `https://flightaware.com/live/flight/${callsign || hex}`
  },
  {
    id: 'adsbexchange',
    label: 'ADSBexchange',
    getUrl: (hex) => `https://globe.adsbexchange.com/?icao=${hex}`
  },
  {
    id: 'flightradar24',
    label: 'Flightradar24',
    getUrl: (hex) => `https://www.flightradar24.com/${hex}`
  },
  {
    id: 'planespotters',
    label: 'Planespotters',
    getUrl: (hex) => `https://planespotters.net/hex/${hex}`
  }
];

export function ExternalLinks({ hex, callsign }) {
  return (
    <nav className="detail-links" aria-label="External resources">
      {LINK_CONFIG.map(link => (
        <a
          key={link.id}
          href={link.getUrl(hex, callsign)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View on ${link.label} (opens in new tab)`}
        >
          {link.label} <ExternalLink size={12} aria-hidden="true" />
        </a>
      ))}
    </nav>
  );
}

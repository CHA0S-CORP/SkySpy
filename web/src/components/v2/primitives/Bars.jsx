import React from 'react';

/**
 * Horizontal labeled bar list (mock: Altitude Distribution / Flight Categories /
 * Safety Events panels — label, track, value).
 *
 * @param {object} props
 * @param {Array<{label: React.ReactNode, value: number, color?: string, display?: React.ReactNode}>} props.items
 * @param {number} [props.max] - defaults to max item value
 */
export function Bars({ items = [], max }) {
  const top = max ?? Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 86, fontSize: 11, color: 'var(--dim)', flex: '0 0 auto' }}>
            {item.label}
          </div>
          <div
            style={{
              flex: 1,
              height: 8,
              borderRadius: 4,
              background: 'var(--bg0)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, ((Number(item.value) || 0) / top) * 100)}%`,
                height: '100%',
                borderRadius: 4,
                background: item.color || 'var(--accent)',
              }}
            />
          </div>
          <div
            className="v2-mono"
            style={{
              width: 46,
              fontSize: 11,
              color: 'var(--txt)',
              textAlign: 'right',
              flex: '0 0 auto',
            }}
          >
            {item.display ?? item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

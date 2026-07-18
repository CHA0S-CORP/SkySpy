import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantChart } from './AssistantChart';

// Leaflet needs a real layout engine — mock the map so the markdown-interception
// test can assert routing without booting Leaflet in jsdom.
vi.mock('./AssistantMap', () => ({
  AssistantMap: ({ spec }) => (
    <div data-testid="asst-map" data-points={spec?.points?.length ?? 0} />
  ),
}));

describe('AssistantMarkdown', () => {
  it('renders markdown formatting (bold, list, table)', () => {
    const md = '**Bold** value\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('table')).toBeTruthy();
  });

  it('renders a ```chart block as an SVG chart, not a code block', () => {
    const md =
      'Here is the breakdown:\n\n```chart\n{"type":"bar","title":"T","xKey":"label","series":[{"name":"Messages","key":"value"}],"data":[{"label":"ACARS","value":5415},{"label":"VDLM2","value":3629}]}\n```';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(2);
    // The fenced JSON must not leak as a visible <pre><code> block.
    expect(container.querySelector('pre code')).toBeFalsy();
  });

  it('shows a placeholder for an incomplete (still-streaming) chart block', () => {
    const md = 'Partial:\n\n```chart\n{"type":"bar","data":[{"label":"A",';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.textContent).toContain('rendering chart');
    expect(container.querySelector('svg')).toBeFalsy();
  });

  it('renders a ```stats block as KPI cards, not a code block', () => {
    const md =
      'Summary:\n\n```stats\n{"title":"Last 24h","cards":[{"label":"Aircraft","value":1823,"delta":12.5},{"label":"Military","value":46,"tone":"warn"}]}\n```';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelector('.v2-asst-stats')).toBeTruthy();
    expect(container.querySelectorAll('.v2-asst-stats__card')).toHaveLength(2);
    expect(container.textContent).toContain('▲ 12.5%');
    expect(container.querySelector('pre code')).toBeFalsy();
  });

  it('renders a ```timeline block as an ordered event list', () => {
    const md =
      '```timeline\n{"events":[{"time":"14:32Z","title":"TCAS RA","tone":"danger"},{"time":"13:10Z","title":"Squawk 7700"}]}\n```';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelectorAll('.v2-asst-tl__item')).toHaveLength(2);
    expect(container.querySelector('pre code')).toBeFalsy();
  });

  it('renders a ```compare block as a table of items x attributes', () => {
    const md =
      '```compare\n{"attributes":["Range","Seats"],"items":[{"name":"A320","values":["3300 nm","150"]},{"name":"B737","values":["3500 nm","162"]}]}\n```';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelector('.v2-asst-cmp')).toBeTruthy();
    // 2 header names + 2 attr row-headers = 4 <th>.
    expect(container.querySelectorAll('.v2-asst-cmp__table th').length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain('3500 nm');
  });

  it('renders a ```callout block with a body and steps', () => {
    const md =
      '```callout\n{"tone":"warn","title":"Heads up","body":"Lost-comms traffic.","steps":["Check log","Confirm on map"]}\n```';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.querySelector('.v2-asst-callout')).toBeTruthy();
    expect(container.querySelectorAll('.v2-asst-callout__steps li')).toHaveLength(2);
    expect(container.textContent).toContain('Heads up');
  });

  it('shows a placeholder for an incomplete (still-streaming) display block', () => {
    const md = '```stats\n{"cards":[{"label":"A",';
    const { container } = render(<AssistantMarkdown text={md} />);
    expect(container.textContent).toContain('rendering stats');
    expect(container.querySelector('.v2-asst-stats')).toBeFalsy();
  });

  it('suppresses a model-authored ```map block (maps render from the tool call)', () => {
    // Maps are rendered from the live_aircraft_map / recent_pireps tool event with
    // exact coordinates — a hand-authored ```map block (rounded/invented coords)
    // must neither render a map nor leak as a visible code block.
    const md =
      'Here they are:\n\n```map\n{"title":"Traffic","points":[{"lat":32.7,"lon":-117.2,"hex":"AE1234"}]}\n```';
    const { queryByTestId, container } = render(<AssistantMarkdown text={md} />);
    expect(queryByTestId('asst-map')).toBeNull();
    expect(container.querySelector('pre code')).toBeFalsy();
  });
});

describe('AssistantMarkdown entity auto-linking', () => {
  const hrefs = (c) => Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));

  it('links ICAO hex, callsigns, and tail numbers to the detail screen', () => {
    const { container } = render(
      <AssistantMarkdown text="Tracked A9A397 as flight ASA1348, tail N842UA." />
    );
    const h = hrefs(container);
    expect(h).toContain('#airframe?icao=A9A397');
    expect(h).toContain('#airframe?call=ASA1348');
    expect(h).toContain('#airframe?tail=N842UA');
  });

  it('does not linkify entities inside inline code', () => {
    const { container } = render(<AssistantMarkdown text="the value `A9A397` is raw" />);
    expect(container.querySelector('a')).toBeFalsy();
    expect(container.querySelector('code')).toBeTruthy();
  });

  it('does not double-link an entity already inside a markdown link', () => {
    const { container } = render(
      <AssistantMarkdown text="[ASA1348](#airframe?call=ASA1348) now" />
    );
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('does not link a plain 6-digit number (e.g. a squawk/count)', () => {
    const { container } = render(<AssistantMarkdown text="There were 123456 messages." />);
    expect(container.querySelector('a')).toBeFalsy();
  });

  it('suppresses model-emitted markdown images (photos render from the tool call)', () => {
    // A hallucinated markdown image URL must never render — airframe photos come
    // from the fetch_airframe_photo tool event, not from the model's markdown.
    const { container } = render(
      <AssistantMarkdown text="![N842UA](https://sky-spy.com/images/airframes/AA7B10.jpg)\n*Photo: Jane Doe*" />
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('preserves agent-emitted page links', () => {
    const { container } = render(
      <AssistantMarkdown text="See [safety events](#history?data=safety)." />
    );
    expect(hrefs(container)).toContain('#history?data=safety');
  });
});

describe('AssistantChart key tolerance', () => {
  it('renders when xKey does not match the data rows (model key drift)', () => {
    // The model sometimes emits xKey:"source" while rows use "label".
    const spec = {
      type: 'bar',
      xKey: 'source',
      series: [{ name: 'Messages', key: 'value' }],
      data: [
        { label: 'ACARS', value: 5415 },
        { label: 'VDLM2', value: 3629 },
      ],
    };
    const { container } = render(<AssistantChart spec={spec} />);
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(2);
  });

  it('derives series from numeric keys when none provided', () => {
    const spec = {
      type: 'line',
      data: [
        { label: '00Z', value: 3 },
        { label: '01Z', value: 7 },
      ],
    };
    const { container } = render(<AssistantChart spec={spec} />);
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('renders a pie chart with slices', () => {
    const spec = {
      type: 'pie',
      series: [{ name: 'n', key: 'value' }],
      data: [
        { label: 'Mil', value: 46 },
        { label: 'Civ', value: 1777 },
      ],
    };
    const { container } = render(<AssistantChart spec={spec} />);
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(2);
  });

  it('renders nothing for empty data', () => {
    const { container } = render(<AssistantChart spec={{ type: 'bar', data: [] }} />);
    expect(container.querySelector('svg')).toBeFalsy();
  });

  it('renders a horizontal bar (hbar) ranking', () => {
    const spec = {
      type: 'hbar',
      series: [{ name: 'Msgs', key: 'value' }],
      data: [
        { label: 'United Airlines', value: 812 },
        { label: 'Delta Air Lines', value: 640 },
        { label: 'American Airlines', value: 511 },
      ],
    };
    const { container } = render(<AssistantChart spec={spec} />);
    expect(container.querySelectorAll('svg rect').length).toBeGreaterThanOrEqual(3);
  });

  it('renders a scatter plot from two numeric fields', () => {
    const spec = {
      type: 'scatter',
      xKey: 'distance',
      series: [{ name: 'Altitude', key: 'altitude' }],
      data: [
        { distance: 12, altitude: 30000, label: 'A' },
        { distance: 45, altitude: 38000, label: 'B' },
        { distance: 80, altitude: 41000, label: 'C' },
      ],
    };
    const { container } = render(<AssistantChart spec={spec} />);
    expect(container.querySelectorAll('svg circle').length).toBe(3);
  });
});

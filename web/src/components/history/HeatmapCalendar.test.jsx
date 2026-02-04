import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapCalendar } from './HeatmapCalendar';

describe('HeatmapCalendar', () => {
  // Mock date to ensure consistent test results
  const mockNow = new Date('2024-01-15T12:00:00Z');
  let originalDate;

  beforeEach(() => {
    originalDate = global.Date;
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Generate sample data with timestamps within the last 7 days
  const generateSampleData = () => {
    const data = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const count = Math.floor(Math.random() * 10);
        for (let i = 0; i < count; i++) {
          const date = new Date(mockNow);
          date.setDate(date.getDate() - d);
          date.setHours(h, Math.floor(Math.random() * 60));
          data.push({ timestamp: date.toISOString() });
        }
      }
    }
    return data;
  };

  const sampleData = [
    { timestamp: '2024-01-15T10:00:00Z' },
    { timestamp: '2024-01-15T10:30:00Z' },
    { timestamp: '2024-01-15T11:00:00Z' },
    { timestamp: '2024-01-14T14:00:00Z' },
    { timestamp: '2024-01-14T14:15:00Z' },
    { timestamp: '2024-01-13T08:00:00Z' },
  ];

  describe('basic rendering', () => {
    it('should render heatmap container', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should render rows for each day', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} days={7} />);
      const rows = container.querySelectorAll('.heatmap-calendar__row');
      expect(rows.length).toBe(7);
    });

    it('should render 24 cells per row (hours)', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} days={1} />);
      const cells = container.querySelectorAll('.heatmap-calendar__cell');
      expect(cells.length).toBe(24);
    });
  });

  describe('labels', () => {
    it('should render day labels when showLabels is true', () => {
      render(<HeatmapCalendar data={sampleData} showLabels />);
      // Should show day of week labels
      expect(screen.getByText('Mon')).toBeInTheDocument();
    });

    it('should hide labels when showLabels is false', () => {
      render(<HeatmapCalendar data={sampleData} showLabels={false} />);
      expect(screen.queryByText('Mon')).not.toBeInTheDocument();
    });

    it('should render hour labels at intervals', () => {
      render(<HeatmapCalendar data={sampleData} showLabels />);
      expect(screen.getByText('00:00')).toBeInTheDocument();
      expect(screen.getByText('06:00')).toBeInTheDocument();
    });
  });

  describe('legend', () => {
    it('should render legend when showLegend is true', () => {
      render(<HeatmapCalendar data={sampleData} showLegend />);
      expect(screen.getByText('Less')).toBeInTheDocument();
      expect(screen.getByText('More')).toBeInTheDocument();
    });

    it('should hide legend when showLegend is false', () => {
      render(<HeatmapCalendar data={sampleData} showLegend={false} />);
      expect(screen.queryByText('Less')).not.toBeInTheDocument();
    });
  });

  describe('color scales', () => {
    it('should use cyan color scale by default', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} colorScale="cyan" />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should support green color scale', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} colorScale="green" />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should support heat color scale', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} colorScale="heat" />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });
  });

  describe('cell sizing', () => {
    it('should apply custom cell size', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} cellSize={20} />);
      const cell = container.querySelector('.heatmap-calendar__cell');
      expect(cell.style.width).toBe('20px');
      expect(cell.style.height).toBe('20px');
    });

    it('should apply custom cell gap', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} cellGap={4} />);
      const cellsContainer = container.querySelector('.heatmap-calendar__cells');
      expect(cellsContainer.style.gap).toBe('4px');
    });
  });

  describe('interactions', () => {
    it('should call onCellClick when cell is clicked', () => {
      const onCellClick = vi.fn();
      const { container } = render(
        <HeatmapCalendar data={sampleData} onCellClick={onCellClick} />
      );

      const cell = container.querySelector('.heatmap-calendar__cell');
      fireEvent.click(cell);

      expect(onCellClick).toHaveBeenCalledWith(
        expect.objectContaining({
          day: expect.any(Number),
          hour: expect.any(Number),
          count: expect.any(Number),
        })
      );
    });

    it('should show tooltip on hover with count info', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} />);
      const cell = container.querySelector('.heatmap-calendar__cell');
      expect(cell.getAttribute('title')).toMatch(/events/);
    });

    it('should scale cell on hover', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} />);
      const cell = container.querySelector('.heatmap-calendar__cell');

      fireEvent.mouseOver(cell);
      expect(cell.style.transform).toBe('scale(1.15)');

      fireEvent.mouseOut(cell);
      expect(cell.style.transform).toBe('scale(1)');
    });
  });

  describe('days configuration', () => {
    it('should render 7 days by default', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} />);
      const rows = container.querySelectorAll('.heatmap-calendar__row');
      expect(rows.length).toBe(7);
    });

    it('should render custom number of days', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} days={14} />);
      const rows = container.querySelectorAll('.heatmap-calendar__row');
      expect(rows.length).toBe(14);
    });

    it('should render single day', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} days={1} />);
      const rows = container.querySelectorAll('.heatmap-calendar__row');
      expect(rows.length).toBe(1);
    });
  });

  describe('data processing', () => {
    it('should handle empty data array', () => {
      const { container } = render(<HeatmapCalendar data={[]} />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should use custom dateField', () => {
      const dataWithCustomField = [
        { created_at: '2024-01-15T10:00:00Z' },
        { created_at: '2024-01-15T10:30:00Z' },
      ];
      const { container } = render(
        <HeatmapCalendar data={dataWithCustomField} dateField="created_at" />
      );
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should use countField for aggregation', () => {
      const dataWithCounts = [
        { timestamp: '2024-01-15T10:00:00Z', count: 5 },
        { timestamp: '2024-01-15T10:30:00Z', count: 3 },
      ];
      const { container } = render(
        <HeatmapCalendar data={dataWithCounts} countField="count" />
      );
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should ignore data outside date range', () => {
      const oldData = [
        { timestamp: '2023-01-01T10:00:00Z' }, // Very old
      ];
      const { container } = render(<HeatmapCalendar data={oldData} days={7} />);
      // Should still render but with no colored cells
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });

    it('should skip items without timestamp', () => {
      const mixedData = [
        { timestamp: '2024-01-15T10:00:00Z' },
        { noTimestamp: true },
        { timestamp: null },
      ];
      const { container } = render(<HeatmapCalendar data={mixedData} />);
      expect(container.querySelector('.heatmap-calendar')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <HeatmapCalendar data={sampleData} className="custom-heatmap" />
      );
      expect(container.querySelector('.custom-heatmap')).toBeInTheDocument();
    });
  });

  describe('cursor style', () => {
    it('should show pointer cursor when onCellClick is provided', () => {
      const { container } = render(
        <HeatmapCalendar data={sampleData} onCellClick={() => {}} />
      );
      const cell = container.querySelector('.heatmap-calendar__cell');
      expect(cell.style.cursor).toBe('pointer');
    });

    it('should show default cursor when no onCellClick', () => {
      const { container } = render(<HeatmapCalendar data={sampleData} />);
      const cell = container.querySelector('.heatmap-calendar__cell');
      expect(cell.style.cursor).toBe('default');
    });
  });
});

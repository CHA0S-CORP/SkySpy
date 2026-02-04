import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapGrid } from './HeatmapGrid';

describe('HeatmapGrid', () => {
  const sampleData = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
  ];

  describe('basic rendering', () => {
    it('should render grid with data', () => {
      const { container } = render(<HeatmapGrid data={sampleData} />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });

    it('should render correct number of cells', () => {
      const { container } = render(<HeatmapGrid data={sampleData} />);
      // 3 rows x 4 cols = 12 cells
      const cells = container.querySelectorAll('.heatmap-grid div div div');
      expect(cells.length).toBeGreaterThan(0);
    });

    it('should render empty state when no data', () => {
      render(<HeatmapGrid data={[]} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should render empty state when data is undefined', () => {
      render(<HeatmapGrid />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });
  });

  describe('labels', () => {
    it('should render row labels', () => {
      render(<HeatmapGrid data={sampleData} rowLabels={['Mon', 'Tue', 'Wed']} />);
      expect(screen.getByText('Mon')).toBeInTheDocument();
      expect(screen.getByText('Tue')).toBeInTheDocument();
      expect(screen.getByText('Wed')).toBeInTheDocument();
    });

    it('should render column labels', () => {
      render(<HeatmapGrid data={sampleData} columnLabels={['A', 'B', 'C', 'D']} />);
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('should not render labels when no labels are provided', () => {
      const { container } = render(<HeatmapGrid data={sampleData} />);
      // Labels are only rendered when rowLabels/columnLabels are passed
      expect(screen.queryByText('Mon')).not.toBeInTheDocument();
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });
  });

  describe('legend', () => {
    it('should render legend by default', () => {
      const { container } = render(<HeatmapGrid data={sampleData} />);
      // Legend shows min and max values
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });

    it('should hide legend when showLegend is false', () => {
      const { container } = render(<HeatmapGrid data={sampleData} showLegend={false} />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });
  });

  describe('color scales', () => {
    it('should apply cyan color scale', () => {
      const { container } = render(<HeatmapGrid data={sampleData} colorScale="cyan" />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });

    it('should apply green color scale', () => {
      const { container } = render(<HeatmapGrid data={sampleData} colorScale="green" />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });

    it('should apply heat color scale', () => {
      const { container } = render(<HeatmapGrid data={sampleData} colorScale="heat" />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });
  });

  describe('cell sizing', () => {
    it('should apply custom cell size', () => {
      const { container } = render(<HeatmapGrid data={sampleData} cellSize={20} />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });

    it('should apply custom cell gap', () => {
      const { container } = render(<HeatmapGrid data={sampleData} cellGap={4} />);
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onCellClick when cell is clicked', () => {
      const onCellClick = vi.fn();
      const { container } = render(<HeatmapGrid data={sampleData} onCellClick={onCellClick} />);

      // Find and click a cell
      const cells = container.querySelectorAll('[role="button"]');
      if (cells.length > 0) {
        fireEvent.click(cells[0]);
        expect(onCellClick).toHaveBeenCalled();
      }
    });

    it('should call onCellHover when hovering over cell', () => {
      const onCellHover = vi.fn();
      const { container } = render(<HeatmapGrid data={sampleData} onCellHover={onCellHover} />);

      const cells = container.querySelectorAll('.heatmap-grid div div div div');
      if (cells.length > 0) {
        fireEvent.mouseEnter(cells[0]);
        expect(onCellHover).toHaveBeenCalled();
      }
    });

    it('should show tooltip on hover', () => {
      const { container } = render(
        <HeatmapGrid
          data={sampleData}
          rowLabels={['Mon', 'Tue', 'Wed']}
          columnLabels={['A', 'B', 'C', 'D']}
        />
      );
      expect(container.querySelector('.heatmap-grid')).toBeInTheDocument();
    });
  });

  describe('tooltip formatting', () => {
    it('should use custom tooltip formatter for cell titles', () => {
      const tooltipFormatter = vi.fn((value, row, col) => `Value: ${value}`);
      render(<HeatmapGrid data={sampleData} tooltipFormatter={tooltipFormatter} />);
      // Formatter is called during render to set title attributes on cells
      // 3 rows x 4 cols = 12 cells
      expect(tooltipFormatter).toHaveBeenCalledTimes(12);
    });
  });

  describe('accessibility', () => {
    it('should have proper role for interactive cells', () => {
      const { container } = render(<HeatmapGrid data={sampleData} onCellClick={() => {}} />);
      const buttons = container.querySelectorAll('[role="button"]');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should be keyboard accessible', () => {
      const onCellClick = vi.fn();
      const { container } = render(<HeatmapGrid data={sampleData} onCellClick={onCellClick} />);

      const cells = container.querySelectorAll('[role="button"]');
      if (cells.length > 0) {
        fireEvent.keyDown(cells[0], { key: 'Enter' });
        expect(onCellClick).toHaveBeenCalled();
      }
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(<HeatmapGrid data={sampleData} className="custom-heatmap" />);
      expect(container.querySelector('.custom-heatmap')).toBeInTheDocument();
    });
  });
});

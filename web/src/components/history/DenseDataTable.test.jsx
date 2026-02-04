import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DenseDataTable } from './DenseDataTable';

describe('DenseDataTable', () => {
  const sampleData = [
    { id: '1', icao_hex: 'A12345', callsign: 'UAL123', altitude: 35000, gs: 450, rssi: -5, is_military: false, safety_event_count: 0 },
    { id: '2', icao_hex: 'B67890', callsign: 'MIL001', altitude: 25000, gs: 380, rssi: -12, is_military: true, safety_event_count: 0 },
    { id: '3', icao_hex: 'C11111', callsign: 'DAL456', altitude: 8000, gs: 250, rssi: -18, is_military: false, safety_event_count: 2 },
  ];

  const sampleColumns = [
    { field: 'callsign', label: 'Callsign', width: '100px' },
    { field: 'altitude', label: 'Altitude', type: 'number', unit: 'ft', align: 'right' },
    { field: 'gs', label: 'Speed', type: 'number', unit: 'kts', align: 'right' },
  ];

  const defaultProps = {
    data: sampleData,
    columns: sampleColumns,
  };

  describe('basic rendering', () => {
    it('should render table container', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      expect(container.querySelector('.dense-data-table')).toBeInTheDocument();
    });

    it('should render header cells', () => {
      render(<DenseDataTable {...defaultProps} />);
      expect(screen.getByText('Callsign')).toBeInTheDocument();
      expect(screen.getByText('Altitude')).toBeInTheDocument();
      expect(screen.getByText('Speed')).toBeInTheDocument();
    });

    it('should render data rows', () => {
      render(<DenseDataTable {...defaultProps} />);
      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('MIL001')).toBeInTheDocument();
      expect(screen.getByText('DAL456')).toBeInTheDocument();
    });

    it('should display row count', () => {
      render(<DenseDataTable {...defaultProps} />);
      expect(screen.getByText('3 rows')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show empty message when data is empty', () => {
      render(<DenseDataTable {...defaultProps} data={[]} />);
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('should show custom empty message', () => {
      render(
        <DenseDataTable {...defaultProps} data={[]} emptyMessage="No sessions found" />
      );
      expect(screen.getByText('No sessions found')).toBeInTheDocument();
    });
  });

  describe('column types', () => {
    it('should format number columns', () => {
      render(<DenseDataTable {...defaultProps} />);
      expect(screen.getByText('35,000')).toBeInTheDocument();
    });

    it('should show unit for number columns', () => {
      render(<DenseDataTable {...defaultProps} />);
      expect(screen.getAllByText('ft').length).toBeGreaterThan(0);
    });

    it('should render sparkline columns', () => {
      const columnsWithSparkline = [
        ...sampleColumns,
        { field: 'altHistory', label: 'History', type: 'sparkline', sparklineWidth: 60 },
      ];
      const dataWithSparkline = sampleData.map((d) => ({
        ...d,
        altHistory: [10000, 20000, 35000, 32000],
      }));
      const { container } = render(
        <DenseDataTable data={dataWithSparkline} columns={columnsWithSparkline} />
      );
      expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    });

    it('should render boolean columns', () => {
      const columnsWithBoolean = [
        ...sampleColumns,
        { field: 'is_military', label: 'Military', type: 'boolean' },
      ];
      const { container } = render(
        <DenseDataTable data={sampleData} columns={columnsWithBoolean} />
      );
      expect(container.querySelector('.dense-data-table__row')).toBeInTheDocument();
    });

    it('should render datetime columns', () => {
      const columnsWithDatetime = [
        ...sampleColumns,
        { field: 'timestamp', label: 'Time', type: 'datetime' },
      ];
      const dataWithTime = sampleData.map((d) => ({
        ...d,
        timestamp: '2024-01-15T10:30:00Z',
      }));
      render(<DenseDataTable data={dataWithTime} columns={columnsWithDatetime} />);
      // Should format as locale string
    });
  });

  describe('color scales', () => {
    it('should apply altitude color scale', () => {
      const columnsWithColor = [
        { field: 'altitude', label: 'Altitude', colorScale: 'altitude' },
      ];
      const { container } = render(
        <DenseDataTable data={sampleData} columns={columnsWithColor} />
      );
      // Color scale classes are applied to span inside cell
      const coloredSpans = container.querySelectorAll('[class*="altitude"]');
      expect(coloredSpans.length).toBeGreaterThan(0);
    });

    it('should apply signal color scale', () => {
      const columnsWithColor = [
        { field: 'rssi', label: 'Signal', colorScale: 'signal' },
      ];
      const { container } = render(
        <DenseDataTable data={sampleData} columns={columnsWithColor} />
      );
      // Color scale classes are applied to span inside cell
      const coloredSpans = container.querySelectorAll('[class*="signal"]');
      expect(coloredSpans.length).toBeGreaterThan(0);
    });
  });

  describe('custom renderers', () => {
    it('should use custom render function', () => {
      const columnsWithCustom = [
        {
          field: 'callsign',
          label: 'Callsign',
          render: (value) => <strong data-testid="custom">{value}</strong>,
        },
      ];
      render(<DenseDataTable data={sampleData} columns={columnsWithCustom} />);
      expect(screen.getAllByTestId('custom').length).toBeGreaterThan(0);
    });
  });

  describe('sorting', () => {
    it('should show sort indicator for sorted column', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} sortField="callsign" sortDirection="asc" />
      );
      expect(container.querySelector('.dense-data-table__header-cell--sorted')).toBeInTheDocument();
      expect(screen.getByText('↑')).toBeInTheDocument();
    });

    it('should show descending indicator', () => {
      render(
        <DenseDataTable {...defaultProps} sortField="callsign" sortDirection="desc" />
      );
      expect(screen.getByText('↓')).toBeInTheDocument();
    });

    it('should call onSort when header is clicked', () => {
      const onSort = vi.fn();
      render(<DenseDataTable {...defaultProps} onSort={onSort} />);

      fireEvent.click(screen.getByText('Callsign'));
      expect(onSort).toHaveBeenCalledWith('callsign', 'desc');
    });

    it('should toggle sort direction when same column clicked', () => {
      const onSort = vi.fn();
      render(
        <DenseDataTable
          {...defaultProps}
          onSort={onSort}
          sortField="callsign"
          sortDirection="desc"
        />
      );

      fireEvent.click(screen.getByText('Callsign'));
      expect(onSort).toHaveBeenCalledWith('callsign', 'asc');
    });

    it('should not sort when column.sortable is false', () => {
      const onSort = vi.fn();
      const columnsNotSortable = [
        { field: 'callsign', label: 'Callsign', sortable: false },
      ];
      render(
        <DenseDataTable data={sampleData} columns={columnsNotSortable} onSort={onSort} />
      );

      fireEvent.click(screen.getByText('Callsign'));
      expect(onSort).not.toHaveBeenCalled();
    });
  });

  describe('row interactions', () => {
    it('should call onRowClick when row is clicked', () => {
      const onRowClick = vi.fn();
      render(<DenseDataTable {...defaultProps} onRowClick={onRowClick} />);

      fireEvent.click(screen.getByText('UAL123'));
      expect(onRowClick).toHaveBeenCalledWith(sampleData[0], 0);
    });

    it('should highlight selected row', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} selectedRow="1" />
      );
      expect(container.querySelector('.dense-data-table__row--selected')).toBeInTheDocument();
    });

    it('should highlight selected row by icao_hex', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} selectedRow="A12345" />
      );
      expect(container.querySelector('.dense-data-table__row--selected')).toBeInTheDocument();
    });
  });

  describe('row styling', () => {
    it('should apply military class to military rows', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      expect(container.querySelector('.dense-data-table__row--military')).toBeInTheDocument();
    });

    it('should apply safety class to rows with safety events', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      expect(container.querySelector('.dense-data-table__row--safety')).toBeInTheDocument();
    });
  });

  describe('virtual scrolling', () => {
    it('should render with virtualization enabled by default', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      expect(container.querySelector('.virtual-scroll-container')).toBeInTheDocument();
    });

    it('should handle scroll events', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} maxHeight={100} rowHeight={32} />
      );
      const scrollContainer = container.querySelector('.virtual-scroll-container');
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 50 } });
      // Should update visible rows
    });

    it('should show visible range indicator when virtualized', () => {
      render(<DenseDataTable {...defaultProps} virtualize />);
      expect(screen.getByText(/Showing/)).toBeInTheDocument();
    });

    it('should not show range indicator when virtualization is off', () => {
      render(<DenseDataTable {...defaultProps} virtualize={false} />);
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    });
  });

  describe('column configuration', () => {
    it('should apply column width', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      const headerCell = container.querySelector('.dense-data-table__header-cell');
      expect(headerCell.style.width).toBe('100px');
    });

    it('should apply column alignment', () => {
      const { container } = render(<DenseDataTable {...defaultProps} />);
      const numericCells = container.querySelectorAll('.dense-data-table__header-cell--numeric');
      expect(numericCells.length).toBeGreaterThan(0);
    });

    it('should apply mono class when specified', () => {
      const columnsWithMono = [
        { field: 'icao_hex', label: 'ICAO', mono: true },
      ];
      const { container } = render(
        <DenseDataTable data={sampleData} columns={columnsWithMono} />
      );
      expect(container.querySelector('.dense-data-table__cell--mono')).toBeInTheDocument();
    });

    it('should apply highlight class when specified', () => {
      const columnsWithHighlight = [
        { field: 'callsign', label: 'Callsign', highlight: true },
      ];
      const { container } = render(
        <DenseDataTable data={sampleData} columns={columnsWithHighlight} />
      );
      expect(container.querySelector('.dense-data-table__cell--highlight')).toBeInTheDocument();
    });
  });

  describe('row height', () => {
    it('should apply custom row height', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} rowHeight={40} />
      );
      const row = container.querySelector('.dense-data-table__row');
      expect(row.style.height).toBe('40px');
    });
  });

  describe('max height', () => {
    it('should apply max height to scroll container', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} maxHeight={300} />
      );
      const scrollContainer = container.querySelector('.virtual-scroll-container');
      expect(scrollContainer.style.height).toBe('300px');
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <DenseDataTable {...defaultProps} className="custom-table" />
      );
      expect(container.querySelector('.custom-table')).toBeInTheDocument();
    });
  });

  describe('large datasets', () => {
    it('should handle 1000 rows', () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        callsign: `FLT${i}`,
        altitude: Math.random() * 40000,
        gs: Math.random() * 500,
      }));
      const { container } = render(
        <DenseDataTable data={largeData} columns={sampleColumns} maxHeight={300} />
      );
      expect(container.querySelector('.dense-data-table')).toBeInTheDocument();
      expect(screen.getByText('1,000 rows')).toBeInTheDocument();
    });
  });
});

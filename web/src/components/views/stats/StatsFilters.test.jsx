import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TimeRangeSelector,
  MilitaryToggle,
  AdvancedFiltersButton,
  AdvancedFiltersPanel,
  StatsFilterBar,
} from './StatsFilters';

describe('TimeRangeSelector', () => {
  const defaultProps = {
    timeRange: '24h',
    onTimeRangeChange: vi.fn(),
  };

  describe('rendering', () => {
    it('should render all time range buttons', () => {
      render(<TimeRangeSelector {...defaultProps} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
    });

    it('should render Time Range label', () => {
      render(<TimeRangeSelector {...defaultProps} />);
      expect(screen.getByText('Time Range')).toBeInTheDocument();
    });

    it('should render clock icon', () => {
      const { container } = render(<TimeRangeSelector {...defaultProps} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('active state', () => {
    it('should mark selected time range as active', () => {
      render(<TimeRangeSelector {...defaultProps} timeRange="6h" />);
      const activeButton = screen.getByText('6h');
      expect(activeButton).toHaveClass('active');
    });

    it('should not mark other buttons as active', () => {
      render(<TimeRangeSelector {...defaultProps} timeRange="6h" />);
      const inactiveButton = screen.getByText('24h');
      expect(inactiveButton).not.toHaveClass('active');
    });
  });

  describe('interaction', () => {
    it('should call onTimeRangeChange when button is clicked', () => {
      const onTimeRangeChange = vi.fn();
      render(<TimeRangeSelector {...defaultProps} onTimeRangeChange={onTimeRangeChange} />);

      fireEvent.click(screen.getByText('7d'));
      expect(onTimeRangeChange).toHaveBeenCalledWith('7d');
    });
  });
});

describe('MilitaryToggle', () => {
  const defaultProps = {
    showMilitaryOnly: false,
    onToggle: vi.fn(),
  };

  describe('rendering', () => {
    it('should render Military Only label', () => {
      render(<MilitaryToggle {...defaultProps} />);
      expect(screen.getByText('Military Only')).toBeInTheDocument();
    });

    it('should render toggle indicator', () => {
      const { container } = render(<MilitaryToggle {...defaultProps} />);
      expect(container.querySelector('.toggle-indicator')).toBeInTheDocument();
    });
  });

  describe('active state', () => {
    it('should have active class when showMilitaryOnly is true', () => {
      const { container } = render(<MilitaryToggle {...defaultProps} showMilitaryOnly={true} />);
      expect(container.querySelector('.filter-toggle')).toHaveClass('active');
    });

    it('should not have active class when showMilitaryOnly is false', () => {
      const { container } = render(<MilitaryToggle {...defaultProps} showMilitaryOnly={false} />);
      expect(container.querySelector('.filter-toggle')).not.toHaveClass('active');
    });
  });

  describe('interaction', () => {
    it('should call onToggle when clicked', () => {
      const onToggle = vi.fn();
      render(<MilitaryToggle {...defaultProps} onToggle={onToggle} />);

      fireEvent.click(screen.getByText('Military Only'));
      expect(onToggle).toHaveBeenCalled();
    });

    it('should call onToggle on Enter key', () => {
      const onToggle = vi.fn();
      const { container } = render(<MilitaryToggle {...defaultProps} onToggle={onToggle} />);

      const toggle = container.querySelector('.filter-toggle');
      fireEvent.keyDown(toggle, { key: 'Enter' });
      expect(onToggle).toHaveBeenCalled();
    });

    it('should call onToggle on Space key', () => {
      const onToggle = vi.fn();
      const { container } = render(<MilitaryToggle {...defaultProps} onToggle={onToggle} />);

      const toggle = container.querySelector('.filter-toggle');
      fireEvent.keyDown(toggle, { key: ' ' });
      expect(onToggle).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have role="button"', () => {
      render(<MilitaryToggle {...defaultProps} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should have tabIndex=0', () => {
      const { container } = render(<MilitaryToggle {...defaultProps} />);
      const toggle = container.querySelector('.filter-toggle');
      expect(toggle).toHaveAttribute('tabIndex', '0');
    });
  });
});

describe('AdvancedFiltersButton', () => {
  const defaultProps = {
    showAdvancedFilters: false,
    onToggle: vi.fn(),
  };

  describe('rendering', () => {
    it('should render Filters label', () => {
      render(<AdvancedFiltersButton {...defaultProps} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should render filter icon', () => {
      const { container } = render(<AdvancedFiltersButton {...defaultProps} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('active state', () => {
    it('should have active class when showAdvancedFilters is true', () => {
      const { container } = render(
        <AdvancedFiltersButton {...defaultProps} showAdvancedFilters={true} />
      );
      expect(container.querySelector('.advanced-filter-btn')).toHaveClass('active');
    });

    it('should have open chevron class when showAdvancedFilters is true', () => {
      const { container } = render(
        <AdvancedFiltersButton {...defaultProps} showAdvancedFilters={true} />
      );
      expect(container.querySelector('.chevron')).toHaveClass('open');
    });
  });

  describe('interaction', () => {
    it('should call onToggle when clicked', () => {
      const onToggle = vi.fn();
      render(<AdvancedFiltersButton {...defaultProps} onToggle={onToggle} />);

      fireEvent.click(screen.getByText('Filters'));
      expect(onToggle).toHaveBeenCalled();
    });
  });
});

describe('AdvancedFiltersPanel', () => {
  const defaultProps = {
    categoryFilter: '',
    setCategoryFilter: vi.fn(),
    aircraftType: '',
    setAircraftType: vi.fn(),
    minAltitude: '',
    setMinAltitude: vi.fn(),
    maxAltitude: '',
    setMaxAltitude: vi.fn(),
    minDistance: '',
    setMinDistance: vi.fn(),
    maxDistance: '',
    setMaxDistance: vi.fn(),
    onClearFilters: vi.fn(),
  };

  describe('rendering', () => {
    it('should render category filter', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByLabelText('Category')).toBeInTheDocument();
    });

    it('should render aircraft type filter', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByLabelText('Aircraft Type')).toBeInTheDocument();
    });

    it('should render altitude filters', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByLabelText('Min Altitude (ft)')).toBeInTheDocument();
      expect(screen.getByLabelText('Max Altitude (ft)')).toBeInTheDocument();
    });

    it('should render distance filters', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByLabelText('Min Distance (nm)')).toBeInTheDocument();
      expect(screen.getByLabelText('Max Distance (nm)')).toBeInTheDocument();
    });

    it('should render Clear Filters button', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByText('Clear Filters')).toBeInTheDocument();
    });
  });

  describe('category options', () => {
    it('should have All Categories option', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      expect(screen.getByText('All Categories')).toBeInTheDocument();
    });

    it('should have A0-A7 category options', () => {
      render(<AdvancedFiltersPanel {...defaultProps} />);
      const select = screen.getByLabelText('Category');
      expect(select.querySelector('option[value="A0"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="A7"]')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('should call setCategoryFilter when category is changed', () => {
      const setCategoryFilter = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setCategoryFilter={setCategoryFilter} />);

      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'A5' } });
      expect(setCategoryFilter).toHaveBeenCalledWith('A5');
    });

    it('should call setAircraftType when aircraft type is changed', () => {
      const setAircraftType = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setAircraftType={setAircraftType} />);

      fireEvent.change(screen.getByLabelText('Aircraft Type'), { target: { value: 'b738' } });
      expect(setAircraftType).toHaveBeenCalledWith('B738');
    });

    it('should uppercase aircraft type input', () => {
      const setAircraftType = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setAircraftType={setAircraftType} />);

      fireEvent.change(screen.getByLabelText('Aircraft Type'), { target: { value: 'a320' } });
      expect(setAircraftType).toHaveBeenCalledWith('A320');
    });

    it('should call setMinAltitude when min altitude is changed', () => {
      const setMinAltitude = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setMinAltitude={setMinAltitude} />);

      fireEvent.change(screen.getByLabelText('Min Altitude (ft)'), { target: { value: '1000' } });
      expect(setMinAltitude).toHaveBeenCalledWith('1000');
    });

    it('should call setMaxAltitude when max altitude is changed', () => {
      const setMaxAltitude = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setMaxAltitude={setMaxAltitude} />);

      fireEvent.change(screen.getByLabelText('Max Altitude (ft)'), { target: { value: '40000' } });
      expect(setMaxAltitude).toHaveBeenCalledWith('40000');
    });

    it('should call setMinDistance when min distance is changed', () => {
      const setMinDistance = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setMinDistance={setMinDistance} />);

      fireEvent.change(screen.getByLabelText('Min Distance (nm)'), { target: { value: '5' } });
      expect(setMinDistance).toHaveBeenCalledWith('5');
    });

    it('should call setMaxDistance when max distance is changed', () => {
      const setMaxDistance = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} setMaxDistance={setMaxDistance} />);

      fireEvent.change(screen.getByLabelText('Max Distance (nm)'), { target: { value: '100' } });
      expect(setMaxDistance).toHaveBeenCalledWith('100');
    });

    it('should call onClearFilters when Clear Filters is clicked', () => {
      const onClearFilters = vi.fn();
      render(<AdvancedFiltersPanel {...defaultProps} onClearFilters={onClearFilters} />);

      fireEvent.click(screen.getByText('Clear Filters'));
      expect(onClearFilters).toHaveBeenCalled();
    });
  });

  describe('controlled values', () => {
    it('should display current categoryFilter value', () => {
      render(<AdvancedFiltersPanel {...defaultProps} categoryFilter="A3" />);
      expect(screen.getByLabelText('Category')).toHaveValue('A3');
    });

    it('should display current aircraftType value', () => {
      render(<AdvancedFiltersPanel {...defaultProps} aircraftType="B777" />);
      expect(screen.getByLabelText('Aircraft Type')).toHaveValue('B777');
    });

    it('should display current altitude values', () => {
      render(<AdvancedFiltersPanel {...defaultProps} minAltitude="5000" maxAltitude="35000" />);
      expect(screen.getByLabelText('Min Altitude (ft)')).toHaveValue(5000);
      expect(screen.getByLabelText('Max Altitude (ft)')).toHaveValue(35000);
    });

    it('should display current distance values', () => {
      render(<AdvancedFiltersPanel {...defaultProps} minDistance="10" maxDistance="200" />);
      expect(screen.getByLabelText('Min Distance (nm)')).toHaveValue(10);
      expect(screen.getByLabelText('Max Distance (nm)')).toHaveValue(200);
    });
  });
});

describe('StatsFilterBar', () => {
  const defaultProps = {
    timeRange: '24h',
    setTimeRange: vi.fn(),
    showMilitaryOnly: false,
    setShowMilitaryOnly: vi.fn(),
    showAdvancedFilters: false,
    setShowAdvancedFilters: vi.fn(),
    categoryFilter: '',
    setCategoryFilter: vi.fn(),
    aircraftType: '',
    setAircraftType: vi.fn(),
    minAltitude: '',
    setMinAltitude: vi.fn(),
    maxAltitude: '',
    setMaxAltitude: vi.fn(),
    minDistance: '',
    setMinDistance: vi.fn(),
    maxDistance: '',
    setMaxDistance: vi.fn(),
  };

  describe('rendering', () => {
    it('should render TimeRangeSelector', () => {
      render(<StatsFilterBar {...defaultProps} />);
      expect(screen.getByText('Time Range')).toBeInTheDocument();
    });

    it('should render MilitaryToggle', () => {
      render(<StatsFilterBar {...defaultProps} />);
      expect(screen.getByText('Military Only')).toBeInTheDocument();
    });

    it('should render AdvancedFiltersButton', () => {
      render(<StatsFilterBar {...defaultProps} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should not render AdvancedFiltersPanel when showAdvancedFilters is false', () => {
      render(<StatsFilterBar {...defaultProps} />);
      expect(screen.queryByLabelText('Category')).not.toBeInTheDocument();
    });

    it('should render AdvancedFiltersPanel when showAdvancedFilters is true', () => {
      render(<StatsFilterBar {...defaultProps} showAdvancedFilters={true} />);
      expect(screen.getByLabelText('Category')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('should call setTimeRange when time range changes', () => {
      const setTimeRange = vi.fn();
      render(<StatsFilterBar {...defaultProps} setTimeRange={setTimeRange} />);

      fireEvent.click(screen.getByText('7d'));
      expect(setTimeRange).toHaveBeenCalledWith('7d');
    });

    it('should toggle military filter', () => {
      const setShowMilitaryOnly = vi.fn();
      render(<StatsFilterBar {...defaultProps} setShowMilitaryOnly={setShowMilitaryOnly} />);

      fireEvent.click(screen.getByText('Military Only'));
      expect(setShowMilitaryOnly).toHaveBeenCalledWith(true);
    });

    it('should toggle advanced filters visibility', () => {
      const setShowAdvancedFilters = vi.fn();
      render(
        <StatsFilterBar {...defaultProps} setShowAdvancedFilters={setShowAdvancedFilters} />
      );

      fireEvent.click(screen.getByText('Filters'));
      expect(setShowAdvancedFilters).toHaveBeenCalledWith(true);
    });
  });

  describe('clear filters', () => {
    it('should clear all filters when Clear Filters is clicked', () => {
      const setCategoryFilter = vi.fn();
      const setAircraftType = vi.fn();
      const setMinAltitude = vi.fn();
      const setMaxAltitude = vi.fn();
      const setMinDistance = vi.fn();
      const setMaxDistance = vi.fn();

      render(
        <StatsFilterBar
          {...defaultProps}
          showAdvancedFilters={true}
          setCategoryFilter={setCategoryFilter}
          setAircraftType={setAircraftType}
          setMinAltitude={setMinAltitude}
          setMaxAltitude={setMaxAltitude}
          setMinDistance={setMinDistance}
          setMaxDistance={setMaxDistance}
        />
      );

      fireEvent.click(screen.getByText('Clear Filters'));

      expect(setCategoryFilter).toHaveBeenCalledWith('');
      expect(setAircraftType).toHaveBeenCalledWith('');
      expect(setMinAltitude).toHaveBeenCalledWith('');
      expect(setMaxAltitude).toHaveBeenCalledWith('');
      expect(setMinDistance).toHaveBeenCalledWith('');
      expect(setMaxDistance).toHaveBeenCalledWith('');
    });
  });
});

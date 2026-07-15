import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterMenu } from './FilterMenu';

describe('FilterMenu', () => {
  const defaultFilters = {
    showMilitary: true,
    showCivil: true,
    showGround: true,
    showAirborne: true,
    minAltitude: 0,
    maxAltitude: 60000,
    showWithSquawk: true,
    showWithoutSquawk: true,
  };

  const mockOnFiltersChange = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should not render when show is false', () => {
      render(
        <FilterMenu
          show={false}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.queryByText('Traffic Filters')).not.toBeInTheDocument();
    });

    it('should render when show is true', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Traffic Filters')).toBeInTheDocument();
    });

    it('should render all filter sections', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Aircraft Type')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Transponder')).toBeInTheDocument();
      expect(screen.getByText('Altitude Range')).toBeInTheDocument();
    });

    it('should render all filter options', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Military')).toBeInTheDocument();
      expect(screen.getByText('Civil')).toBeInTheDocument();
      expect(screen.getByText('Airborne')).toBeInTheDocument();
      expect(screen.getByText('Ground')).toBeInTheDocument();
      expect(screen.getByText('With Squawk')).toBeInTheDocument();
      expect(screen.getByText('Without Squawk')).toBeInTheDocument();
    });

    it('should render reset button', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Reset Filters')).toBeInTheDocument();
    });
  });

  describe('checkbox state', () => {
    it('should reflect current filter values in checkboxes', () => {
      const filters = {
        ...defaultFilters,
        showMilitary: false,
        showCivil: true,
        showGround: false,
        showAirborne: true,
      };

      render(
        <FilterMenu
          show={true}
          filters={filters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const militaryCheckbox = screen.getByRole('checkbox', { name: /military/i });
      const civilCheckbox = screen.getByRole('checkbox', { name: /civil/i });
      const groundCheckbox = screen.getByRole('checkbox', { name: /ground/i });
      const airborneCheckbox = screen.getByRole('checkbox', { name: /airborne/i });

      expect(militaryCheckbox).not.toBeChecked();
      expect(civilCheckbox).toBeChecked();
      expect(groundCheckbox).not.toBeChecked();
      expect(airborneCheckbox).toBeChecked();
    });
  });

  describe('filter interactions', () => {
    it('should call onFiltersChange when military filter is toggled', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const militaryCheckbox = screen.getByRole('checkbox', { name: /military/i });
      await user.click(militaryCheckbox);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        showMilitary: false,
      });
    });

    it('should call onFiltersChange when civil filter is toggled', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const civilCheckbox = screen.getByRole('checkbox', { name: /civil/i });
      await user.click(civilCheckbox);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        showCivil: false,
      });
    });

    it('should call onFiltersChange when ground filter is toggled', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const groundCheckbox = screen.getByRole('checkbox', { name: /ground/i });
      await user.click(groundCheckbox);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        showGround: false,
      });
    });

    it('should call onFiltersChange when airborne filter is toggled', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const airborneCheckbox = screen.getByRole('checkbox', { name: /airborne/i });
      await user.click(airborneCheckbox);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        showAirborne: false,
      });
    });

    it('should call onFiltersChange when squawk filters are toggled', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const withSquawkCheckbox = screen.getByRole('checkbox', { name: /with squawk/i });
      await user.click(withSquawkCheckbox);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        showWithSquawk: false,
      });
    });
  });

  describe('altitude range inputs', () => {
    it('should display altitude inputs with current values', () => {
      render(
        <FilterMenu
          show={true}
          filters={{ ...defaultFilters, minAltitude: 5000, maxAltitude: 40000 }}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const minInput = screen.getByDisplayValue('5000');
      const maxInput = screen.getByDisplayValue('40000');

      expect(minInput).toBeInTheDocument();
      expect(maxInput).toBeInTheDocument();
    });

    it('should call onFiltersChange when min altitude is changed', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const minInput = screen.getByDisplayValue('0');
      fireEvent.change(minInput, { target: { value: '5000' } });

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        minAltitude: 5000,
      });
    });

    it('should call onFiltersChange when max altitude is changed', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const maxInput = screen.getByDisplayValue('60000');
      fireEvent.change(maxInput, { target: { value: '45000' } });

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        maxAltitude: 45000,
      });
    });

    it('should handle invalid altitude input gracefully', () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const minInput = screen.getByDisplayValue('0');
      fireEvent.change(minInput, { target: { value: 'invalid' } });

      // Should default to 0 when invalid
      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        ...defaultFilters,
        minAltitude: 0,
      });
    });
  });

  describe('reset functionality', () => {
    it('should reset all filters to defaults when reset button is clicked', async () => {
      const user = userEvent.setup();
      const modifiedFilters = {
        showMilitary: false,
        showCivil: false,
        showGround: false,
        showAirborne: false,
        minAltitude: 10000,
        maxAltitude: 30000,
        showWithSquawk: false,
        showWithoutSquawk: false,
      };

      render(
        <FilterMenu
          show={true}
          filters={modifiedFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const resetButton = screen.getByText('Reset Filters');
      await user.click(resetButton);

      expect(mockOnFiltersChange).toHaveBeenCalledWith({
        showMilitary: true,
        showCivil: true,
        showGround: true,
        showAirborne: true,
        minAltitude: 0,
        maxAltitude: 60000,
        showWithSquawk: true,
        showWithoutSquawk: true,
      });
    });
  });

  describe('close functionality', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      const closeButton = screen.getByRole('button', { name: '' });
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', async () => {
      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when clicking outside the menu', async () => {
      vi.useFakeTimers();

      render(
        <div>
          <div data-testid="outside">Outside</div>
          <FilterMenu
            show={true}
            filters={defaultFilters}
            onFiltersChange={mockOnFiltersChange}
            onClose={mockOnClose}
          />
        </div>
      );

      // Wait for the timeout in the component
      vi.advanceTimersByTime(10);

      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside);

      expect(mockOnClose).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not call onClose when clicking inside the menu', async () => {
      vi.useFakeTimers();

      render(
        <FilterMenu
          show={true}
          filters={defaultFilters}
          onFiltersChange={mockOnFiltersChange}
          onClose={mockOnClose}
        />
      );

      vi.advanceTimersByTime(10);

      const menuContent = screen.getByText('Traffic Filters');
      fireEvent.mouseDown(menuContent);

      expect(mockOnClose).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});

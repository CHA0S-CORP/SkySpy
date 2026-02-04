import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioFilters from './AudioFilters';

describe('AudioFilters', () => {
  const defaultProps = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    statusFilter: 'all',
    onStatusFilterChange: vi.fn(),
    channelFilter: 'all',
    onChannelFilterChange: vi.fn(),
    availableChannels: ['Tower', 'Ground', 'Approach'],
    flightMatchFilter: 'all',
    onFlightMatchFilterChange: vi.fn(),
    airlineFilter: 'all',
    onAirlineFilterChange: vi.fn(),
    availableAirlines: [
      { icao: 'UAL', name: 'United Airlines' },
      { icao: 'DAL', name: 'Delta Air Lines' },
    ],
    flightTypeFilter: 'all',
    onFlightTypeFilterChange: vi.fn(),
    callsignFilter: '',
    onCallsignFilterChange: vi.fn(),
    emergencyFilter: false,
    onEmergencyFilterChange: vi.fn(),
    onClearFilters: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('text search', () => {
    it('should render search input with placeholder', () => {
      render(<AudioFilters {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText(
        'Search transcripts, channels, frequencies...'
      );
      expect(searchInput).toBeInTheDocument();
    });

    it('should display current search query value', () => {
      render(<AudioFilters {...defaultProps} searchQuery="mayday" />);

      const searchInput = screen.getByPlaceholderText(
        'Search transcripts, channels, frequencies...'
      );
      expect(searchInput).toHaveValue('mayday');
    });

    it('should call onSearchChange when typing in search', () => {
      render(<AudioFilters {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText(
        'Search transcripts, channels, frequencies...'
      );
      fireEvent.change(searchInput, { target: { value: 'runway' } });

      expect(defaultProps.onSearchChange).toHaveBeenCalledWith('runway');
    });

    it('should render search box container', () => {
      render(<AudioFilters {...defaultProps} />);

      const searchBox = document.querySelector('.search-box');
      expect(searchBox).toBeInTheDocument();
    });
  });

  describe('status filter', () => {
    it('should render status filter dropdown', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('All Status')).toBeInTheDocument();
    });

    it('should display all status options', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Status');
      expect(select.querySelector('option[value="all"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="completed"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="processing"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="queued"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="pending"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="failed"]')).toBeInTheDocument();
    });

    it('should call onStatusFilterChange when status is changed', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Status');
      fireEvent.change(select, { target: { value: 'completed' } });

      expect(defaultProps.onStatusFilterChange).toHaveBeenCalledWith('completed');
    });

    it('should show selected status value', () => {
      render(<AudioFilters {...defaultProps} statusFilter="processing" />);

      const select = document.querySelectorAll('.audio-select')[0];
      expect(select).toHaveValue('processing');
    });
  });

  describe('channel filter', () => {
    it('should render channel filter dropdown', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('All Channels')).toBeInTheDocument();
    });

    it('should display available channels', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('Tower')).toBeInTheDocument();
      expect(screen.getByText('Ground')).toBeInTheDocument();
      expect(screen.getByText('Approach')).toBeInTheDocument();
    });

    it('should call onChannelFilterChange when channel is selected', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Channels');
      fireEvent.change(select, { target: { value: 'Tower' } });

      expect(defaultProps.onChannelFilterChange).toHaveBeenCalledWith('Tower');
    });

    it('should render empty channel list when no channels available', () => {
      render(<AudioFilters {...defaultProps} availableChannels={[]} />);

      const select = screen.getByDisplayValue('All Channels');
      expect(select.querySelectorAll('option')).toHaveLength(1);
    });
  });

  describe('flight match filter', () => {
    it('should render flight match filter dropdown', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('All Transmissions')).toBeInTheDocument();
    });

    it('should display flight match options', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Transmissions');
      expect(select.querySelector('option[value="all"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="matched"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="unmatched"]')).toBeInTheDocument();
    });

    it('should call onFlightMatchFilterChange when selection changes', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Transmissions');
      fireEvent.change(select, { target: { value: 'matched' } });

      expect(defaultProps.onFlightMatchFilterChange).toHaveBeenCalledWith('matched');
    });
  });

  describe('airline filter', () => {
    it('should render airline filter dropdown', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('All Airlines')).toBeInTheDocument();
    });

    it('should display available airlines with name and ICAO code', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('United Airlines (UAL)')).toBeInTheDocument();
      expect(screen.getByText('Delta Air Lines (DAL)')).toBeInTheDocument();
    });

    it('should call onAirlineFilterChange when airline is selected', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Airlines');
      fireEvent.change(select, { target: { value: 'UAL' } });

      expect(defaultProps.onAirlineFilterChange).toHaveBeenCalledWith('UAL');
    });

    it('should disable airline filter when no airlines available', () => {
      render(<AudioFilters {...defaultProps} availableAirlines={[]} />);

      const select = screen.getByDisplayValue('All Airlines');
      expect(select).toBeDisabled();
    });

    it('should enable airline filter when airlines are available', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Airlines');
      expect(select).not.toBeDisabled();
    });
  });

  describe('flight type filter', () => {
    it('should render flight type filter dropdown', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('All Types')).toBeInTheDocument();
    });

    it('should display flight type options', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Types');
      expect(select.querySelector('option[value="all"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="airline"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="general_aviation"]')).toBeInTheDocument();
      expect(select.querySelector('option[value="military"]')).toBeInTheDocument();
    });

    it('should call onFlightTypeFilterChange when type is selected', () => {
      render(<AudioFilters {...defaultProps} />);

      const select = screen.getByDisplayValue('All Types');
      fireEvent.change(select, { target: { value: 'military' } });

      expect(defaultProps.onFlightTypeFilterChange).toHaveBeenCalledWith('military');
    });
  });

  describe('callsign filter', () => {
    it('should render callsign filter input', () => {
      render(<AudioFilters {...defaultProps} />);

      const input = screen.getByPlaceholderText('Callsign...');
      expect(input).toBeInTheDocument();
    });

    it('should display current callsign filter value', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="UAL123" />);

      const input = screen.getByPlaceholderText('Callsign...');
      expect(input).toHaveValue('UAL123');
    });

    it('should call onCallsignFilterChange when typing', () => {
      render(<AudioFilters {...defaultProps} />);

      const input = screen.getByPlaceholderText('Callsign...');
      fireEvent.change(input, { target: { value: 'DAL456' } });

      expect(defaultProps.onCallsignFilterChange).toHaveBeenCalledWith('DAL456');
    });

    it('should show clear button when callsign filter has value', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="UAL123" />);

      const clearBtn = document.querySelector('.clear-callsign-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should not show clear button when callsign filter is empty', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="" />);

      const clearBtn = document.querySelector('.clear-callsign-btn');
      expect(clearBtn).not.toBeInTheDocument();
    });

    it('should call onCallsignFilterChange with empty string when clear button clicked', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="UAL123" />);

      const clearBtn = document.querySelector('.clear-callsign-btn');
      fireEvent.click(clearBtn);

      expect(defaultProps.onCallsignFilterChange).toHaveBeenCalledWith('');
    });

    it('should have correct title on clear button', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="UAL123" />);

      const clearBtn = document.querySelector('.clear-callsign-btn');
      expect(clearBtn).toHaveAttribute('title', 'Clear callsign filter');
    });
  });

  describe('emergency filter', () => {
    it('should render emergency filter button', () => {
      render(<AudioFilters {...defaultProps} />);

      expect(screen.getByText('Emergency')).toBeInTheDocument();
    });

    it('should mark emergency button as active when filter is enabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      expect(emergencyBtn).toHaveClass('active');
    });

    it('should not mark emergency button as active when filter is disabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={false} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      expect(emergencyBtn).not.toHaveClass('active');
    });

    it('should call onEmergencyFilterChange with true when clicked and disabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={false} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      fireEvent.click(emergencyBtn);

      expect(defaultProps.onEmergencyFilterChange).toHaveBeenCalledWith(true);
    });

    it('should call onEmergencyFilterChange with false when clicked and enabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      fireEvent.click(emergencyBtn);

      expect(defaultProps.onEmergencyFilterChange).toHaveBeenCalledWith(false);
    });

    it('should have correct title when emergency filter is disabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={false} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      expect(emergencyBtn).toHaveAttribute(
        'title',
        'Show only emergency transmissions (mayday, pan pan, etc.)'
      );
    });

    it('should have correct title when emergency filter is enabled', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const emergencyBtn = screen.getByText('Emergency').closest('button');
      expect(emergencyBtn).toHaveAttribute('title', 'Show all transmissions');
    });
  });

  describe('clear filters button', () => {
    it('should not render clear filters button when no active filters', () => {
      render(<AudioFilters {...defaultProps} />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).not.toBeInTheDocument();
    });

    it('should render clear filters button when flightMatchFilter is active', () => {
      render(<AudioFilters {...defaultProps} flightMatchFilter="matched" />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should render clear filters button when airlineFilter is active', () => {
      render(<AudioFilters {...defaultProps} airlineFilter="UAL" />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should render clear filters button when flightTypeFilter is active', () => {
      render(<AudioFilters {...defaultProps} flightTypeFilter="airline" />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should render clear filters button when callsignFilter has value', () => {
      render(<AudioFilters {...defaultProps} callsignFilter="UAL123" />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should render clear filters button when emergencyFilter is active', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toBeInTheDocument();
    });

    it('should call onClearFilters when clear button is clicked', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      fireEvent.click(clearBtn);

      expect(defaultProps.onClearFilters).toHaveBeenCalledTimes(1);
    });

    it('should have correct title on clear filters button', () => {
      render(<AudioFilters {...defaultProps} emergencyFilter={true} />);

      const clearBtn = document.querySelector('.clear-filters-btn');
      expect(clearBtn).toHaveAttribute('title', 'Clear all flight filters');
    });
  });

  describe('component structure', () => {
    it('should render with correct container class', () => {
      render(<AudioFilters {...defaultProps} />);

      const container = document.querySelector('.audio-filters');
      expect(container).toBeInTheDocument();
    });

    it('should render callsign filter container', () => {
      render(<AudioFilters {...defaultProps} />);

      const callsignFilter = document.querySelector('.callsign-filter');
      expect(callsignFilter).toBeInTheDocument();
    });

    it('should render all select elements with audio-select class', () => {
      render(<AudioFilters {...defaultProps} />);

      const selects = document.querySelectorAll('.audio-select');
      expect(selects).toHaveLength(5); // status, channel, flight match, airline, flight type
    });
  });
});

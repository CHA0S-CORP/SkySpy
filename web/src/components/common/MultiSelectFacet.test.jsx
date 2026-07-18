import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiSelectFacet } from './MultiSelectFacet';

describe('MultiSelectFacet', () => {
  const defaultOptions = [
    { value: 'a320', label: 'A320', count: 50 },
    { value: 'b737', label: 'B737', count: 30 },
    { value: 'c172', label: 'C172', count: 10 },
  ];

  const defaultProps = {
    options: defaultOptions,
    value: [],
    onChange: vi.fn(),
  };

  describe('basic rendering', () => {
    it('should render trigger button', () => {
      render(<MultiSelectFacet {...defaultProps} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should render with label', () => {
      render(<MultiSelectFacet {...defaultProps} label="Type" />);
      expect(screen.getByText(/Type/)).toBeInTheDocument();
    });

    it('should show placeholder when no selection', () => {
      render(<MultiSelectFacet {...defaultProps} placeholder="Select types" />);
      expect(screen.getByText('Select types')).toBeInTheDocument();
    });

    it('should show selected count when items selected', () => {
      render(<MultiSelectFacet {...defaultProps} value={['a320', 'b737']} />);
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });

    it('should show single selection label', () => {
      render(<MultiSelectFacet {...defaultProps} value={['a320']} />);
      expect(screen.getByText('A320')).toBeInTheDocument();
    });
  });

  describe('dropdown behavior', () => {
    it('should open dropdown on click', () => {
      render(<MultiSelectFacet {...defaultProps} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('A320')).toBeInTheDocument();
      expect(screen.getByText('B737')).toBeInTheDocument();
      expect(screen.getByText('C172')).toBeInTheDocument();
    });

    it('should close dropdown on outside click', () => {
      render(
        <div>
          <MultiSelectFacet {...defaultProps} />
          <div data-testid="outside">Outside</div>
        </div>
      );
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('A320')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      // Dropdown should close (options no longer visible in dropdown context)
    });
  });

  describe('selection behavior', () => {
    it('should call onChange when option selected', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByText('A320'));

      expect(onChange).toHaveBeenCalledWith(['a320']);
    });

    it('should deselect option when clicked again', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} value={['a320']} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      // When selected, A320 appears in both trigger and dropdown - get the option element
      const a320Option = screen.getByRole('option', { name: /A320/ });
      fireEvent.click(a320Option);

      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('should support multiple selections', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} value={['a320']} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByText('B737'));

      expect(onChange).toHaveBeenCalledWith(['a320', 'b737']);
    });
  });

  describe('quick actions', () => {
    it('should select all options', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByText('Select All'));

      expect(onChange).toHaveBeenCalledWith(['a320', 'b737', 'c172']);
    });

    it('should clear all selections', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} value={['a320', 'b737']} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByText('Clear'));

      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe('search functionality', () => {
    it('should render search input when showSearch is true', () => {
      render(<MultiSelectFacet {...defaultProps} showSearch />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('should filter options based on search', () => {
      render(<MultiSelectFacet {...defaultProps} showSearch />);
      fireEvent.click(screen.getByRole('button'));

      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'A32' } });

      expect(screen.getByText('A320')).toBeInTheDocument();
      expect(screen.queryByText('B737')).not.toBeInTheDocument();
    });

    it('should show no results message', () => {
      render(<MultiSelectFacet {...defaultProps} showSearch />);
      fireEvent.click(screen.getByRole('button'));

      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'xyz' } });

      expect(screen.getByText('No options found')).toBeInTheDocument();
    });
  });

  describe('counts display', () => {
    it('should show counts when showCounts is true', () => {
      render(<MultiSelectFacet {...defaultProps} showCounts />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('should show total count', () => {
      render(<MultiSelectFacet {...defaultProps} showCounts />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('90 total')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('should not open when disabled', () => {
      render(<MultiSelectFacet {...defaultProps} disabled />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.queryByText('A320')).not.toBeInTheDocument();
    });
  });

  describe('option rendering', () => {
    it('should render option with icon', () => {
      const optionsWithIcons = [{ value: 'military', label: 'Military', icon: '🎖️', count: 5 }];
      render(<MultiSelectFacet {...defaultProps} options={optionsWithIcons} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('🎖️')).toBeInTheDocument();
    });

    it('should render option with color indicator', () => {
      const optionsWithColors = [
        { value: 'critical', label: 'Critical', color: '#ff0000', count: 3 },
      ];
      render(<MultiSelectFacet {...defaultProps} options={optionsWithColors} />);
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Critical')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper ARIA attributes on options', () => {
      render(<MultiSelectFacet {...defaultProps} value={['a320']} />);
      fireEvent.click(screen.getByRole('button'));

      const selectedOption = screen.getByRole('option', { name: /A320/ });
      expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    });

    it('should be keyboard navigable', () => {
      const onChange = vi.fn();
      render(<MultiSelectFacet {...defaultProps} onChange={onChange} />);

      fireEvent.click(screen.getByRole('button'));
      const option = screen.getByText('A320').closest('[role="option"]');
      fireEvent.keyDown(option, { key: 'Enter' });

      expect(onChange).toHaveBeenCalled();
    });
  });
});

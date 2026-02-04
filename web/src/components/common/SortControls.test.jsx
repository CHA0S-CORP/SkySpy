import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SortControls } from './SortControls';

describe('SortControls', () => {
  const defaultFields = [
    { key: 'distance', label: 'Distance' },
    { key: 'altitude', label: 'Altitude' },
    { key: 'speed', label: 'Speed' },
  ];

  const defaultProps = {
    fields: defaultFields,
    activeField: 'distance',
    direction: 'asc',
    onSort: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSort.mockClear();
  });

  describe('desktop pill buttons', () => {
    it('should render sort label', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      // Both desktop and mobile versions have "Sort:" label
      expect(container.querySelector('.sort-controls-label')).toHaveTextContent('Sort:');
    });

    it('should render all field options as buttons', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      // Both desktop pills and mobile dropdown have buttons, check the pills section
      const pills = container.querySelectorAll('.sort-pill');
      expect(pills).toHaveLength(3);
      expect(screen.getAllByText('Distance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Altitude').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Speed').length).toBeGreaterThan(0);
    });

    it('should mark active field with active class', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const activePill = container.querySelector('.sort-pill.active');
      expect(activePill).toBeInTheDocument();
      expect(activePill).toHaveTextContent('Distance');
    });

    it('should call onSort when pill is clicked', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      // Click on the Altitude pill in the pills section
      const pills = container.querySelectorAll('.sort-pill');
      const altitudePill = Array.from(pills).find((p) => p.textContent.includes('Altitude'));
      fireEvent.click(altitudePill);

      expect(defaultProps.onSort).toHaveBeenCalledWith('altitude');
    });

    it('should call onSort when active pill is clicked (for toggle)', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      // Click on the active Distance pill
      const activePill = container.querySelector('.sort-pill.active');
      fireEvent.click(activePill);

      expect(defaultProps.onSort).toHaveBeenCalledWith('distance');
    });

    it('should have title attribute on buttons', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const distancePill = container.querySelector('.sort-pill.active');
      expect(distancePill).toHaveAttribute('title', 'Sort by Distance');
    });
  });

  describe('sort direction indicator', () => {
    it('should show direction icon on active field', () => {
      const { container } = render(<SortControls {...defaultProps} direction="asc" />);

      const activePill = container.querySelector('.sort-pill.active');
      expect(activePill.querySelector('.sort-direction-icon')).toBeInTheDocument();
    });

    it('should not show direction icon on inactive fields', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const inactivePills = container.querySelectorAll('.sort-pill:not(.active)');
      inactivePills.forEach((pill) => {
        expect(pill.querySelector('.sort-direction-icon')).not.toBeInTheDocument();
      });
    });
  });

  describe('mobile dropdown', () => {
    it('should render dropdown trigger', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      expect(container.querySelector('.sort-dropdown-trigger')).toBeInTheDocument();
    });

    it('should show active field label in dropdown trigger', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const dropdownValue = container.querySelector('.sort-dropdown-value');
      expect(dropdownValue).toHaveTextContent('Distance');
    });

    it('should open dropdown menu on click', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      expect(container.querySelector('.sort-dropdown-menu')).toBeInTheDocument();
    });

    it('should close dropdown menu on second click', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);
      expect(container.querySelector('.sort-dropdown-menu')).toBeInTheDocument();

      fireEvent.click(trigger);
      expect(container.querySelector('.sort-dropdown-menu')).not.toBeInTheDocument();
    });

    it('should render all options in dropdown menu', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      const menuItems = container.querySelectorAll('.sort-dropdown-item');
      expect(menuItems).toHaveLength(3);
    });

    it('should call onSort and close dropdown when option is selected', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      const menuItems = container.querySelectorAll('.sort-dropdown-item');
      fireEvent.click(menuItems[1]); // Click Altitude

      expect(defaultProps.onSort).toHaveBeenCalledWith('altitude');
      expect(container.querySelector('.sort-dropdown-menu')).not.toBeInTheDocument();
    });

    it('should mark active option in dropdown', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      const activeItem = container.querySelector('.sort-dropdown-item.active');
      expect(activeItem).toHaveTextContent('Distance');
    });

    it('should rotate chevron when dropdown is open', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      const chevron = container.querySelector('.sort-dropdown-chevron.open');
      expect(chevron).toBeInTheDocument();
    });
  });

  describe('click outside to close', () => {
    it('should close dropdown when clicking outside', async () => {
      const { container } = render(
        <div>
          <SortControls {...defaultProps} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);
      expect(container.querySelector('.sort-dropdown-menu')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'));

      expect(container.querySelector('.sort-dropdown-menu')).not.toBeInTheDocument();
    });

    it('should not close when clicking inside dropdown', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      // Click on the dropdown container (not on an item)
      const dropdownMenu = container.querySelector('.sort-dropdown-menu');
      fireEvent.mouseDown(dropdownMenu);

      expect(container.querySelector('.sort-dropdown-menu')).toBeInTheDocument();
    });
  });

  describe('styling variants', () => {
    it('should apply compact class when compact prop is true', () => {
      const { container } = render(<SortControls {...defaultProps} compact={true} />);

      expect(container.querySelector('.sort-controls-container.compact')).toBeInTheDocument();
    });

    it('should not apply compact class by default', () => {
      const { container } = render(<SortControls {...defaultProps} />);

      expect(container.querySelector('.sort-controls-container.compact')).not.toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(<SortControls {...defaultProps} className="my-custom-class" />);

      expect(container.querySelector('.sort-controls-container.my-custom-class')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle empty fields array', () => {
      const { container } = render(
        <SortControls {...defaultProps} fields={[]} activeField="" />
      );

      const pills = container.querySelectorAll('.sort-pill');
      expect(pills).toHaveLength(0);
    });

    it('should handle single field', () => {
      const { container } = render(
        <SortControls
          {...defaultProps}
          fields={[{ key: 'single', label: 'Single' }]}
          activeField="single"
        />
      );

      // Both desktop pill and mobile dropdown render buttons with the field name
      const singleButtons = screen.getAllByRole('button', { name: /single/i });
      expect(singleButtons.length).toBeGreaterThan(0);
    });

    it('should handle field not found in fields array', () => {
      const { container } = render(
        <SortControls {...defaultProps} activeField="nonexistent" />
      );

      // Should still render, using the key as label fallback
      const dropdownValue = container.querySelector('.sort-dropdown-value');
      expect(dropdownValue).toHaveTextContent('nonexistent');
    });
  });

  describe('cleanup', () => {
    it('should remove event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { container, unmount } = render(<SortControls {...defaultProps} />);

      // Open dropdown to add event listener
      const trigger = container.querySelector('.sort-dropdown-trigger');
      fireEvent.click(trigger);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });
});

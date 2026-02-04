import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverlayMenu } from './OverlayMenu';

describe('OverlayMenu', () => {
  const defaultOverlays = {
    navaids: false,
    airports: false,
    waypoints: false,
    airspace: false,
    tfrs: false,
    notams: false,
    metars: false,
    pireps: false,
    radar: false,
    advisories: false,
    rangeRings: false,
    trails: false,
    labels: false,
  };

  const mockOnOverlaysChange = vi.fn();
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
        <OverlayMenu
          show={false}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.queryByText('Map Overlays')).not.toBeInTheDocument();
    });

    it('should render when show is true', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Map Overlays')).toBeInTheDocument();
    });

    it('should render all section titles', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Navigation')).toBeInTheDocument();
      expect(screen.getByText('Airspace')).toBeInTheDocument();
      expect(screen.getByText('Weather')).toBeInTheDocument();
      expect(screen.getByText('Display')).toBeInTheDocument();
    });

    it('should render navigation overlay options', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('NAVAIDs (VOR/NDB)')).toBeInTheDocument();
      expect(screen.getByText('Airports')).toBeInTheDocument();
      expect(screen.getByText('Waypoints')).toBeInTheDocument();
    });

    it('should render airspace overlay options', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Controlled Airspace')).toBeInTheDocument();
      expect(screen.getByText('TFRs')).toBeInTheDocument();
      expect(screen.getByText('NOTAMs')).toBeInTheDocument();
    });

    it('should render weather overlay options', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('METARs')).toBeInTheDocument();
      expect(screen.getByText('PIREPs')).toBeInTheDocument();
      expect(screen.getByText('Weather Radar')).toBeInTheDocument();
      expect(screen.getByText('Weather Advisories')).toBeInTheDocument();
    });

    it('should render display overlay options', () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Range Rings')).toBeInTheDocument();
      expect(screen.getByText('Aircraft Trails')).toBeInTheDocument();
      expect(screen.getByText('Aircraft Labels')).toBeInTheDocument();
    });
  });

  describe('checkbox state', () => {
    it('should reflect current overlay values in checkboxes', () => {
      const overlays = {
        ...defaultOverlays,
        navaids: true,
        airports: true,
        metars: false,
        trails: true,
      };

      render(
        <OverlayMenu
          show={true}
          overlays={overlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      // Find checkboxes by their associated labels
      const navaidsCheckbox = screen.getByRole('checkbox', { name: /navaids/i });
      const airportsCheckbox = screen.getByRole('checkbox', { name: /airports/i });
      const metarsCheckbox = screen.getByRole('checkbox', { name: /metars/i });
      const trailsCheckbox = screen.getByRole('checkbox', { name: /aircraft trails/i });

      expect(navaidsCheckbox).toBeChecked();
      expect(airportsCheckbox).toBeChecked();
      expect(metarsCheckbox).not.toBeChecked();
      expect(trailsCheckbox).toBeChecked();
    });
  });

  describe('overlay toggle interactions', () => {
    it('should toggle navaids overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const navaidsCheckbox = screen.getByRole('checkbox', { name: /navaids/i });
      await user.click(navaidsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        navaids: true,
      });
    });

    it('should toggle airports overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const airportsCheckbox = screen.getByRole('checkbox', { name: /airports/i });
      await user.click(airportsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        airports: true,
      });
    });

    it('should toggle airspace overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const airspaceCheckbox = screen.getByRole('checkbox', { name: /controlled airspace/i });
      await user.click(airspaceCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        airspace: true,
      });
    });

    it('should toggle TFRs overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const tfrsCheckbox = screen.getByRole('checkbox', { name: /tfrs/i });
      await user.click(tfrsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        tfrs: true,
      });
    });

    it('should toggle metars overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const metarsCheckbox = screen.getByRole('checkbox', { name: /metars/i });
      await user.click(metarsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        metars: true,
      });
    });

    it('should toggle pireps overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const pirepsCheckbox = screen.getByRole('checkbox', { name: /pireps/i });
      await user.click(pirepsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        pireps: true,
      });
    });

    it('should toggle range rings overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const rangeRingsCheckbox = screen.getByRole('checkbox', { name: /range rings/i });
      await user.click(rangeRingsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        rangeRings: true,
      });
    });

    it('should toggle trails overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const trailsCheckbox = screen.getByRole('checkbox', { name: /aircraft trails/i });
      await user.click(trailsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        trails: true,
      });
    });

    it('should toggle labels overlay when clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const labelsCheckbox = screen.getByRole('checkbox', { name: /aircraft labels/i });
      await user.click(labelsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        labels: true,
      });
    });

    it('should turn off overlay when already on', async () => {
      const user = userEvent.setup();
      const overlaysWithNavaids = {
        ...defaultOverlays,
        navaids: true,
      };

      render(
        <OverlayMenu
          show={true}
          overlays={overlaysWithNavaids}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const navaidsCheckbox = screen.getByRole('checkbox', { name: /navaids/i });
      await user.click(navaidsCheckbox);

      expect(mockOnOverlaysChange).toHaveBeenCalledWith({
        ...defaultOverlays,
        navaids: false,
      });
    });
  });

  describe('close functionality', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      const closeButton = screen.getByRole('button', { name: '' });
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', async () => {
      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
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
          <OverlayMenu
            show={true}
            overlays={defaultOverlays}
            onOverlaysChange={mockOnOverlaysChange}
            onClose={mockOnClose}
          />
        </div>
      );

      vi.advanceTimersByTime(10);

      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside);

      expect(mockOnClose).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should not call onClose when clicking inside the menu', async () => {
      vi.useFakeTimers();

      render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      vi.advanceTimersByTime(10);

      const menuContent = screen.getByText('Map Overlays');
      fireEvent.mouseDown(menuContent);

      expect(mockOnClose).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('event listener cleanup', () => {
    it('should clean up event listeners when unmounted', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = render(
        <OverlayMenu
          show={true}
          overlays={defaultOverlays}
          onOverlaysChange={mockOnOverlaysChange}
          onClose={mockOnClose}
        />
      );

      // Should have added listeners for keydown and mousedown (with timeout)
      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      unmount();

      // Should clean up listeners
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});

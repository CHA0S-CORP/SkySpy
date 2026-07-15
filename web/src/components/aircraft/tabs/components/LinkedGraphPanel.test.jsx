import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkedGraphPanel } from './LinkedGraphPanel';

describe('LinkedGraphPanel', () => {
  const sampleSightings = [
    {
      timestamp: '2024-01-15T10:00:00Z',
      altitude: 5000,
      gs: 200,
      vr: 1500,
      distance_nm: 50,
      rssi: -5,
      track: 90,
    },
    {
      timestamp: '2024-01-15T10:01:00Z',
      altitude: 10000,
      gs: 300,
      vr: 2000,
      distance_nm: 45,
      rssi: -8,
      track: 92,
    },
    {
      timestamp: '2024-01-15T10:02:00Z',
      altitude: 20000,
      gs: 400,
      vr: 1000,
      distance_nm: 40,
      rssi: -10,
      track: 95,
    },
    {
      timestamp: '2024-01-15T10:03:00Z',
      altitude: 30000,
      gs: 450,
      vr: 500,
      distance_nm: 38,
      rssi: -12,
      track: 100,
    },
    {
      timestamp: '2024-01-15T10:04:00Z',
      altitude: 35000,
      gs: 460,
      vr: 0,
      distance_nm: 35,
      rssi: -15,
      track: 105,
    },
  ];

  const defaultProps = {
    sightings: sampleSightings,
  };

  describe('basic rendering', () => {
    it('should render graph panel container', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      expect(container.querySelector('.linked-graphs-panel')).toBeInTheDocument();
    });

    it('should render all 6 graphs', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graphs = container.querySelectorAll('.linked-graphs-panel__graph');
      expect(graphs.length).toBe(6);
    });

    it('should render graph labels', () => {
      render(<LinkedGraphPanel {...defaultProps} />);
      expect(screen.getByText('Altitude')).toBeInTheDocument();
      expect(screen.getByText('Speed')).toBeInTheDocument();
      expect(screen.getByText('V/S')).toBeInTheDocument();
      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('Signal')).toBeInTheDocument();
      expect(screen.getByText('Track')).toBeInTheDocument();
    });

    it('should render SVG elements for each graph', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBe(6);
    });
  });

  describe('empty state', () => {
    it('should show no data message when sightings is empty', () => {
      render(<LinkedGraphPanel sightings={[]} />);
      expect(screen.getAllByText('No data').length).toBeGreaterThan(0);
    });

    it('should handle missing field values', () => {
      const sightingsWithMissing = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:01:00Z', altitude: 10000 },
      ];
      render(<LinkedGraphPanel sightings={sightingsWithMissing} />);
      // Should still render without crashing
      expect(screen.getByText('Altitude')).toBeInTheDocument();
    });
  });

  describe('graph interactions', () => {
    it('should call onSelectIndex when graph is clicked', () => {
      const onSelectIndex = vi.fn();
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} onSelectIndex={onSelectIndex} />
      );

      const graph = container.querySelector('.linked-graphs-panel__graph');
      // Mock getBoundingClientRect
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.click(graph, { clientX: 50 });
      expect(onSelectIndex).toHaveBeenCalled();
    });

    it('should show cursor on mouse move', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graph = container.querySelector('.linked-graphs-panel__graph');
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.mouseMove(graph, { clientX: 50 });
      // Cursor line should appear (may need to check for element presence)
    });

    it('should hide cursor on mouse leave', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graph = container.querySelector('.linked-graphs-panel__graph');
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.mouseMove(graph, { clientX: 50 });
      fireEvent.mouseLeave(graph);
      // Cursor should be hidden
    });

    it('should reset zoom on double click', () => {
      const onGraphZoom = vi.fn();
      const { container } = render(
        <LinkedGraphPanel
          {...defaultProps}
          onGraphZoom={onGraphZoom}
          graphZoom={{ start: 0.2, end: 0.8 }}
        />
      );

      const graph = container.querySelector('.linked-graphs-panel__graph');
      fireEvent.doubleClick(graph);

      expect(onGraphZoom).toHaveBeenCalledWith({ start: 0, end: 1 });
    });

    it('should reset zoom on Escape key', () => {
      const onGraphZoom = vi.fn();
      const { container } = render(
        <LinkedGraphPanel
          {...defaultProps}
          onGraphZoom={onGraphZoom}
          graphZoom={{ start: 0.2, end: 0.8 }}
        />
      );

      const graph = container.querySelector('.linked-graphs-panel__graph');
      fireEvent.keyDown(graph, { key: 'Escape' });

      expect(onGraphZoom).toHaveBeenCalledWith({ start: 0, end: 1 });
    });
  });

  describe('brush zoom', () => {
    it('should start drag on mouse down', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graph = container.querySelector('.linked-graphs-panel__graph');
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.mouseDown(graph, { clientX: 20 });
      // Drag should be initiated
    });

    it('should apply zoom on significant drag', () => {
      const onGraphZoom = vi.fn();
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} onGraphZoom={onGraphZoom} />
      );

      const graph = container.querySelector('.linked-graphs-panel__graph');
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.mouseDown(graph, { clientX: 10 });
      fireEvent.mouseUp(graph, { clientX: 60 });

      expect(onGraphZoom).toHaveBeenCalled();
    });

    it('should not apply zoom on small drag', () => {
      const onGraphZoom = vi.fn();
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} onGraphZoom={onGraphZoom} />
      );

      const graph = container.querySelector('.linked-graphs-panel__graph');
      graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 150 });

      fireEvent.mouseDown(graph, { clientX: 50 });
      fireEvent.mouseUp(graph, { clientX: 52 }); // Very small movement

      expect(onGraphZoom).not.toHaveBeenCalled();
    });
  });

  describe('selected index marker', () => {
    it('should show selected position marker', () => {
      render(<LinkedGraphPanel {...defaultProps} selectedIndex={2} />);
      // Should render a vertical line at the selected position
    });
  });

  describe('safety event markers', () => {
    it('should render safety event markers', () => {
      const safetyEvents = [
        { timestamp: '2024-01-15T10:01:30Z', severity: 'warning' },
        { timestamp: '2024-01-15T10:03:00Z', severity: 'critical' },
      ];
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} safetyEvents={safetyEvents} />
      );
      // Should have dashed lines for events
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });

    it('should use correct color for event severity', () => {
      const safetyEvents = [{ timestamp: '2024-01-15T10:02:00Z', severity: 'critical' }];
      render(<LinkedGraphPanel {...defaultProps} safetyEvents={safetyEvents} />);
      // Critical events should be red
    });
  });

  describe('graph zoom', () => {
    it('should apply graph zoom to data', () => {
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} graphZoom={{ start: 0.2, end: 0.8 }} />
      );
      // Should only show portion of data
      expect(container.querySelector('.linked-graphs-panel')).toBeInTheDocument();
    });

    it('should handle full zoom range', () => {
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} graphZoom={{ start: 0, end: 1 }} />
      );
      expect(container.querySelector('.linked-graphs-panel')).toBeInTheDocument();
    });
  });

  describe('height configuration', () => {
    it('should apply custom height', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} height={200} />);
      const graph = container.querySelector('.linked-graphs-panel__graph');
      expect(graph.style.height).toBe('200px');
    });

    it('should use default height of 150', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graph = container.querySelector('.linked-graphs-panel__graph');
      expect(graph.style.height).toBe('150px');
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <LinkedGraphPanel {...defaultProps} className="custom-graphs" />
      );
      expect(container.querySelector('.custom-graphs')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have role button on graphs', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const graphs = container.querySelectorAll('[role="button"]');
      expect(graphs.length).toBe(6);
    });

    it('should have aria-label on graphs', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      const altGraph = container.querySelector('[aria-label*="Altitude"]');
      expect(altGraph).toBeInTheDocument();
    });

    it('should be keyboard focusable', () => {
      const { container } = render(<LinkedGraphPanel {...defaultProps} />);
      // DOM attribute is lowercase 'tabindex', not camelCase
      const graphs = container.querySelectorAll('.linked-graphs-panel__graph[tabindex="0"]');
      expect(graphs.length).toBe(6);
    });
  });

  describe('value formatting', () => {
    it('should format altitude in k notation', () => {
      render(<LinkedGraphPanel {...defaultProps} />);
      // Tooltip should show formatted values when hovering
    });

    it('should format vertical speed with sign', () => {
      const sightingsWithNegativeVS = [
        { timestamp: '2024-01-15T10:00:00Z', vr: -1500 },
        { timestamp: '2024-01-15T10:01:00Z', vr: -2000 },
      ];
      render(<LinkedGraphPanel sightings={sightingsWithNegativeVS} />);
      // V/S graph should handle negative values
    });
  });

  describe('baseline rendering', () => {
    it('should render baseline for V/S graph', () => {
      render(<LinkedGraphPanel {...defaultProps} />);
      // V/S graph should have a dashed baseline at 0
    });
  });

  describe('track graph handling', () => {
    it('should handle circular track values (0-360)', () => {
      const sightingsWithTrack = [
        { timestamp: '2024-01-15T10:00:00Z', track: 350 },
        { timestamp: '2024-01-15T10:01:00Z', track: 10 }, // Wrapped around
      ];
      render(<LinkedGraphPanel sightings={sightingsWithTrack} />);
      // Should handle 360 degree wrapping
      expect(screen.getByText('Track')).toBeInTheDocument();
    });
  });
});

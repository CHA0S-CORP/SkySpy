import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MetarPopup } from './MetarPopup';

// Mock the decoder utility
vi.mock('../../../../utils', () => ({
  decodeMetar: (metar) => {
    if (!metar) return null;
    return {
      raw: metar.rawOb || '',
      station: metar.stationId || metar.icaoId || '',
      time: '14:53 Local',
      flightCategory: metar.fltCat || 'VFR',
      flightCategoryDesc: 'Visual Flight Rules - Good visibility (>5mi), ceiling >3000ft',
      wind: metar.wspd !== undefined ? {
        text: `${metar.wdir || 0}° at ${metar.wspd}kt`,
        direction: metar.wdir || 0,
        speed: metar.wspd,
        description: 'Moderate winds',
      } : null,
      visibility: metar.visib !== undefined ? {
        value: metar.visib,
        unit: 'SM',
        description: 'Good visibility',
      } : null,
      temperature: metar.temp !== undefined ? {
        celsius: metar.temp,
        fahrenheit: Math.round((metar.temp * 9) / 5 + 32),
        description: 'Warm',
      } : null,
      dewpoint: metar.dewp !== undefined ? {
        celsius: metar.dewp,
        spread: metar.temp - metar.dewp,
        fogRisk: 'Low fog risk',
      } : null,
      altimeter: metar.altim !== undefined ? {
        inhg: (metar.altim / 100).toFixed(2),
        mb: Math.round(metar.altim * 0.338639),
        description: 'Normal pressure',
      } : null,
      clouds: metar.clouds || [],
      weather: metar.wxString ? [{
        code: metar.wxString,
        description: 'Rain',
      }] : [],
    };
  },
  windDirToCardinal: (deg) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8] || 'N';
  },
}));

describe('MetarPopup', () => {
  const mockMetar = {
    stationId: 'KSEA',
    icaoId: 'KSEA',
    name: 'Seattle-Tacoma International',
    fltCat: 'VFR',
    rawOb: 'KSEA 031453Z 18012KT 10SM FEW035 BKN060 22/14 A3012',
    temp: 22,
    dewp: 14,
    wdir: 180,
    wspd: 12,
    visib: 10,
    altim: 3012,
    clouds: [
      { cover: 'FEW', base: 3500 },
      { cover: 'BKN', base: 6000 },
    ],
    wxString: null,
    obsTime: '2024-01-03T14:53:00Z',
  };

  const mockConfig = {
    mapMode: 'crt',
  };

  const defaultProps = {
    metar: mockMetar,
    config: mockConfig,
    popupPosition: { x: 100, y: 100 },
    isDragging: false,
    onClose: vi.fn(),
    onMouseDown: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should not render when metar is null', () => {
      render(<MetarPopup {...defaultProps} metar={null} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render when metar is provided', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display station identifier', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('KSEA')).toBeInTheDocument();
    });

    it('should display station name when available', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('Seattle-Tacoma International')).toBeInTheDocument();
    });

    it('should display flight category badge', () => {
      const { container } = render(<MetarPopup {...defaultProps} />);

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('VFR');
    });

    it('should display conditions description', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/Visual Flight Rules/)).toBeInTheDocument();
    });
  });

  describe('temperature display', () => {
    it('should display temperature in Celsius and Fahrenheit', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/22°C/)).toBeInTheDocument();
      expect(screen.getByText(/72°F/)).toBeInTheDocument();
    });

    it('should display temperature description', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('Warm')).toBeInTheDocument();
    });
  });

  describe('dewpoint display', () => {
    it('should display dewpoint temperature', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/14°C/)).toBeInTheDocument();
    });

    it('should display dewpoint spread', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/Spread: 8°C/)).toBeInTheDocument();
    });

    it('should display fog risk', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/Low fog risk/)).toBeInTheDocument();
    });
  });

  describe('wind display', () => {
    it('should display wind information', () => {
      render(<MetarPopup {...defaultProps} />);

      // Should show cardinal direction and wind text
      expect(screen.getByText(/Wind/)).toBeInTheDocument();
      expect(screen.getByText(/12kt/)).toBeInTheDocument();
    });

    it('should display wind description', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('Moderate winds')).toBeInTheDocument();
    });
  });

  describe('visibility display', () => {
    it('should display visibility value and unit', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/10 SM/)).toBeInTheDocument();
    });

    it('should display visibility description', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('Good visibility')).toBeInTheDocument();
    });
  });

  describe('altimeter display', () => {
    it('should display altimeter in inches of mercury', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/30.12/)).toBeInTheDocument();
    });

    it('should display pressure description', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('Normal pressure')).toBeInTheDocument();
    });
  });

  describe('cloud layers display', () => {
    it('should display cloud layers', () => {
      const { container } = render(<MetarPopup {...defaultProps} />);

      const cloudLayers = container.querySelectorAll('.cloud-layer');
      expect(cloudLayers.length).toBeGreaterThan(0);
    });
  });

  describe('raw METAR display', () => {
    it('should display raw METAR text', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText(/KSEA 031453Z 18012KT/)).toBeInTheDocument();
    });
  });

  describe('observation time', () => {
    it('should display observation time', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByText('14:53 Local')).toBeInTheDocument();
    });
  });

  describe('flight category styling', () => {
    it('should apply vfr class for VFR conditions', () => {
      const { container } = render(<MetarPopup {...defaultProps} />);

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toHaveClass('vfr');
    });

    it('should apply mvfr class for MVFR conditions', () => {
      const { container } = render(
        <MetarPopup {...defaultProps} metar={{ ...mockMetar, fltCat: 'MVFR' }} />
      );

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toHaveClass('mvfr');
    });

    it('should apply ifr class for IFR conditions', () => {
      const { container } = render(
        <MetarPopup {...defaultProps} metar={{ ...mockMetar, fltCat: 'IFR' }} />
      );

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toHaveClass('ifr');
    });

    it('should apply lifr class for LIFR conditions', () => {
      const { container } = render(
        <MetarPopup {...defaultProps} metar={{ ...mockMetar, fltCat: 'LIFR' }} />
      );

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toHaveClass('lifr');
    });
  });

  describe('close button', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      render(<MetarPopup {...defaultProps} />);

      const closeButton = screen.getByRole('button');
      await user.click(closeButton);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('drag handle', () => {
    it('should have drag handle element', () => {
      const { container } = render(<MetarPopup {...defaultProps} />);

      const dragHandle = container.querySelector('.popup-drag-handle');
      expect(dragHandle).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('should apply crt-popup class for crt mode', () => {
      render(<MetarPopup {...defaultProps} config={{ mapMode: 'crt' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('crt-popup');
    });

    it('should apply pro-popup class for pro mode', () => {
      render(<MetarPopup {...defaultProps} config={{ mapMode: 'pro' }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('pro-popup');
    });

    it('should apply dragging class when isDragging is true', () => {
      render(<MetarPopup {...defaultProps} isDragging={true} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveClass('dragging');
    });

    it('should apply popup position from props', () => {
      render(<MetarPopup {...defaultProps} popupPosition={{ x: 250, y: 180 }} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveStyle({ left: '250px', top: '180px' });
    });
  });

  describe('accessibility', () => {
    it('should have proper dialog role', () => {
      render(<MetarPopup {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should have aria-label with station identifier', () => {
      render(<MetarPopup {...defaultProps} />);

      const popup = screen.getByRole('dialog');
      expect(popup).toHaveAttribute('aria-label', 'METAR weather for KSEA');
    });
  });

  describe('alternate field names', () => {
    it('should use icaoId when stationId is not available', () => {
      render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, stationId: undefined }}
        />
      );

      expect(screen.getByText('KSEA')).toBeInTheDocument();
    });

    it('should default flight category to VFR when not provided', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, fltCat: undefined }}
        />
      );

      const badge = container.querySelector('.flt-cat-badge');
      expect(badge).toHaveTextContent('VFR');
    });
  });

  describe('edge cases', () => {
    it('should handle metar without temperature', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, temp: undefined }}
        />
      );

      const popup = container.querySelector('.weather-popup');
      expect(popup).toBeInTheDocument();
    });

    it('should handle metar without wind', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, wspd: undefined, wdir: undefined }}
        />
      );

      const popup = container.querySelector('.weather-popup');
      expect(popup).toBeInTheDocument();
    });

    it('should handle metar without visibility', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, visib: undefined }}
        />
      );

      const popup = container.querySelector('.weather-popup');
      expect(popup).toBeInTheDocument();
    });

    it('should handle metar without clouds', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, clouds: [] }}
        />
      );

      const popup = container.querySelector('.weather-popup');
      expect(popup).toBeInTheDocument();
    });

    it('should handle metar without raw observation', () => {
      const { container } = render(
        <MetarPopup
          {...defaultProps}
          metar={{ ...mockMetar, rawOb: undefined }}
        />
      );

      const popup = container.querySelector('.weather-popup');
      expect(popup).toBeInTheDocument();
    });
  });
});

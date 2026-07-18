import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  Skeleton,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonAudioItem,
  SkeletonAircraftInfo,
  SkeletonLeaderboard,
  SkeletonKPICard,
  SkeletonSessionCard,
} from './Skeleton';

describe('Skeleton', () => {
  describe('base component', () => {
    it('should render with default variant (text)', () => {
      const { container } = render(<Skeleton />);

      expect(container.querySelector('.skeleton')).toBeInTheDocument();
      expect(container.querySelector('.skeleton-text')).toBeInTheDocument();
    });

    it('should render with card variant', () => {
      const { container } = render(<Skeleton variant="card" />);

      expect(container.querySelector('.skeleton-card')).toBeInTheDocument();
    });

    it('should render with circle variant', () => {
      const { container } = render(<Skeleton variant="circle" />);

      expect(container.querySelector('.skeleton-circle')).toBeInTheDocument();
    });

    it('should render with rect variant', () => {
      const { container } = render(<Skeleton variant="rect" />);

      expect(container.querySelector('.skeleton-rect')).toBeInTheDocument();
    });
  });

  describe('dimensions', () => {
    describe('text variant', () => {
      it('should have default width 100%', () => {
        const { container } = render(<Skeleton variant="text" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ width: '100%' });
      });

      it('should have default height 16px', () => {
        const { container } = render(<Skeleton variant="text" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ height: '16px' });
      });
    });

    describe('card variant', () => {
      it('should have default width 100%', () => {
        const { container } = render(<Skeleton variant="card" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ width: '100%' });
      });

      it('should have default height 100px', () => {
        const { container } = render(<Skeleton variant="card" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ height: '100px' });
      });
    });

    describe('circle variant', () => {
      it('should have equal width and height', () => {
        const { container } = render(<Skeleton variant="circle" width={50} />);

        const skeleton = container.querySelector('.skeleton');
        expect(skeleton).toHaveStyle({ width: '50px', height: '50px' });
      });

      it('should use height for size when only height provided', () => {
        const { container } = render(<Skeleton variant="circle" height={60} />);

        const skeleton = container.querySelector('.skeleton');
        expect(skeleton).toHaveStyle({ width: '60px', height: '60px' });
      });

      it('should use default size of 40px', () => {
        const { container } = render(<Skeleton variant="circle" />);

        const skeleton = container.querySelector('.skeleton');
        expect(skeleton).toHaveStyle({ width: '40px', height: '40px' });
      });
    });

    describe('rect variant', () => {
      it('should have default width 100%', () => {
        const { container } = render(<Skeleton variant="rect" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ width: '100%' });
      });

      it('should have default height 40px', () => {
        const { container } = render(<Skeleton variant="rect" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ height: '40px' });
      });
    });

    describe('custom dimensions', () => {
      it('should accept numeric width', () => {
        const { container } = render(<Skeleton width={200} />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ width: '200px' });
      });

      it('should accept string width', () => {
        const { container } = render(<Skeleton width="50%" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ width: '50%' });
      });

      it('should accept numeric height', () => {
        const { container } = render(<Skeleton height={100} />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ height: '100px' });
      });

      it('should accept string height', () => {
        const { container } = render(<Skeleton height="2rem" />);

        expect(container.querySelector('.skeleton')).toHaveStyle({ height: '2rem' });
      });
    });
  });

  describe('multiple skeletons (count)', () => {
    it('should render single skeleton by default', () => {
      const { container } = render(<Skeleton />);

      const skeletons = container.querySelectorAll('.skeleton');
      expect(skeletons).toHaveLength(1);
    });

    it('should render multiple skeletons when count > 1', () => {
      const { container } = render(<Skeleton count={3} />);

      const skeletons = container.querySelectorAll('.skeleton');
      expect(skeletons).toHaveLength(3);
    });

    it('should wrap multiple skeletons in a group', () => {
      const { container } = render(<Skeleton count={3} />);

      expect(container.querySelector('.skeleton-group')).toBeInTheDocument();
    });

    it('should apply gap between multiple skeletons', () => {
      const { container } = render(<Skeleton count={3} gap={12} />);

      expect(container.querySelector('.skeleton-group')).toHaveStyle({ gap: '12px' });
    });

    it('should use default gap of 8px', () => {
      const { container } = render(<Skeleton count={3} />);

      expect(container.querySelector('.skeleton-group')).toHaveStyle({ gap: '8px' });
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(<Skeleton className="my-custom-class" />);

      expect(container.querySelector('.skeleton.my-custom-class')).toBeInTheDocument();
    });

    it('should apply custom style', () => {
      const { container } = render(<Skeleton style={{ borderRadius: '8px' }} />);

      expect(container.querySelector('.skeleton')).toHaveStyle({ borderRadius: '8px' });
    });

    it('should merge custom style with default dimensions', () => {
      const { container } = render(<Skeleton width={100} height={50} style={{ opacity: 0.5 }} />);

      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toHaveStyle({ width: '100px', height: '50px', opacity: '0.5' });
    });
  });
});

describe('SkeletonCard', () => {
  it('should render card container', () => {
    const { container } = render(<SkeletonCard />);

    expect(container.querySelector('.skeleton-card-container')).toBeInTheDocument();
  });

  it('should render header with circle and text', () => {
    const { container } = render(<SkeletonCard />);

    expect(container.querySelector('.skeleton-card-header')).toBeInTheDocument();
    expect(container.querySelector('.skeleton-circle')).toBeInTheDocument();
  });

  it('should render content section', () => {
    const { container } = render(<SkeletonCard />);

    expect(container.querySelector('.skeleton-card-content')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonCard className="custom-card" />);

    expect(container.querySelector('.skeleton-card-container.custom-card')).toBeInTheDocument();
  });
});

describe('SkeletonTableRow', () => {
  it('should render table row', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow />
        </tbody>
      </table>
    );

    expect(container.querySelector('.skeleton-table-row')).toBeInTheDocument();
  });

  it('should render 5 columns by default', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow />
        </tbody>
      </table>
    );

    const cells = container.querySelectorAll('td');
    expect(cells).toHaveLength(5);
  });

  it('should render custom number of columns', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow columns={3} />
        </tbody>
      </table>
    );

    const cells = container.querySelectorAll('td');
    expect(cells).toHaveLength(3);
  });

  it('should apply custom className', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonTableRow className="custom-row" />
        </tbody>
      </table>
    );

    expect(container.querySelector('.skeleton-table-row.custom-row')).toBeInTheDocument();
  });
});

describe('SkeletonAudioItem', () => {
  it('should render audio item container', () => {
    const { container } = render(<SkeletonAudioItem />);

    expect(container.querySelector('.skeleton-audio-item')).toBeInTheDocument();
  });

  it('should render circle avatar placeholder', () => {
    const { container } = render(<SkeletonAudioItem />);

    expect(container.querySelector('.skeleton-circle')).toBeInTheDocument();
  });

  it('should render audio info section', () => {
    const { container } = render(<SkeletonAudioItem />);

    expect(container.querySelector('.skeleton-audio-info')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonAudioItem className="custom-audio" />);

    expect(container.querySelector('.skeleton-audio-item.custom-audio')).toBeInTheDocument();
  });
});

describe('SkeletonAircraftInfo', () => {
  it('should render aircraft info container', () => {
    const { container } = render(<SkeletonAircraftInfo />);

    expect(container.querySelector('.skeleton-aircraft-info')).toBeInTheDocument();
  });

  it('should render photo placeholder', () => {
    const { container } = render(<SkeletonAircraftInfo />);

    expect(container.querySelector('.skeleton-aircraft-photo')).toBeInTheDocument();
  });

  it('should render details section', () => {
    const { container } = render(<SkeletonAircraftInfo />);

    expect(container.querySelector('.skeleton-aircraft-details')).toBeInTheDocument();
  });

  it('should render stats section', () => {
    const { container } = render(<SkeletonAircraftInfo />);

    expect(container.querySelector('.skeleton-aircraft-stats')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonAircraftInfo className="custom-aircraft" />);

    expect(container.querySelector('.skeleton-aircraft-info.custom-aircraft')).toBeInTheDocument();
  });
});

describe('SkeletonLeaderboard', () => {
  it('should render leaderboard container', () => {
    const { container } = render(<SkeletonLeaderboard />);

    expect(container.querySelector('.skeleton-leaderboard')).toBeInTheDocument();
  });

  it('should render header section', () => {
    const { container } = render(<SkeletonLeaderboard />);

    expect(container.querySelector('.skeleton-leaderboard-header')).toBeInTheDocument();
  });

  it('should render 3 items by default', () => {
    const { container } = render(<SkeletonLeaderboard />);

    const items = container.querySelectorAll('.skeleton-leaderboard-item');
    expect(items).toHaveLength(3);
  });

  it('should render custom number of items', () => {
    const { container } = render(<SkeletonLeaderboard items={5} />);

    const items = container.querySelectorAll('.skeleton-leaderboard-item');
    expect(items).toHaveLength(5);
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonLeaderboard className="custom-leaderboard" />);

    expect(container.querySelector('.skeleton-leaderboard.custom-leaderboard')).toBeInTheDocument();
  });
});

describe('SkeletonKPICard', () => {
  it('should render KPI card container', () => {
    const { container } = render(<SkeletonKPICard />);

    expect(container.querySelector('.skeleton-kpi-card')).toBeInTheDocument();
  });

  it('should render header section', () => {
    const { container } = render(<SkeletonKPICard />);

    expect(container.querySelector('.skeleton-kpi-header')).toBeInTheDocument();
  });

  it('should render metrics section', () => {
    const { container } = render(<SkeletonKPICard />);

    expect(container.querySelector('.skeleton-kpi-metrics')).toBeInTheDocument();
  });

  it('should render multiple metric placeholders', () => {
    const { container } = render(<SkeletonKPICard />);

    const metrics = container.querySelectorAll('.skeleton-kpi-metric');
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonKPICard className="custom-kpi" />);

    expect(container.querySelector('.skeleton-kpi-card.custom-kpi')).toBeInTheDocument();
  });
});

describe('SkeletonSessionCard', () => {
  it('should render session card container', () => {
    const { container } = render(<SkeletonSessionCard />);

    expect(container.querySelector('.skeleton-session-card')).toBeInTheDocument();
  });

  it('should render header section', () => {
    const { container } = render(<SkeletonSessionCard />);

    expect(container.querySelector('.skeleton-session-header')).toBeInTheDocument();
  });

  it('should render identity section', () => {
    const { container } = render(<SkeletonSessionCard />);

    expect(container.querySelector('.skeleton-session-identity')).toBeInTheDocument();
  });

  it('should render stats section', () => {
    const { container } = render(<SkeletonSessionCard />);

    expect(container.querySelector('.skeleton-session-stats')).toBeInTheDocument();
  });

  it('should render footer section', () => {
    const { container } = render(<SkeletonSessionCard />);

    expect(container.querySelector('.skeleton-session-footer')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(<SkeletonSessionCard className="custom-session" />);

    expect(container.querySelector('.skeleton-session-card.custom-session')).toBeInTheDocument();
  });
});

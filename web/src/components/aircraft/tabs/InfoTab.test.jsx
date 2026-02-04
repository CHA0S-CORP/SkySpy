import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InfoTab } from './InfoTab';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Info: () => <span data-testid="info-icon">Info</span>,
  Plane: () => <span data-testid="plane-icon">Plane</span>,
  Building2: () => <span data-testid="building-icon">Building2</span>,
  FileText: () => <span data-testid="file-icon">FileText</span>,
  Camera: () => <span data-testid="camera-icon">Camera</span>,
  ChevronDown: () => <span data-testid="chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="chevron-up">ChevronUp</span>,
}));

// Mock the card components
vi.mock('./info', () => ({
  AirframeCard: ({ data }) => (
    <div data-testid="airframe-card">AirframeCard - {data?.type_name || 'Unknown'}</div>
  ),
  OperatorCard: ({ data }) => (
    <div data-testid="operator-card">OperatorCard - {data?.operator || 'Unknown'}</div>
  ),
  RegistrationCard: ({ data, hex }) => (
    <div data-testid="registration-card">
      RegistrationCard - {data?.registration || hex || 'Unknown'}
    </div>
  ),
  PhotoCard: ({ photoInfo }) => (
    <div data-testid="photo-card">PhotoCard - {photoInfo?.photographer || 'Unknown'}</div>
  ),
  DataSourcesAccordion: ({ sourceData }) => (
    <div data-testid="data-sources-accordion">
      DataSourcesAccordion - {sourceData?.length || 0} sources
    </div>
  ),
}));

describe('InfoTab', () => {
  const mockInfo = {
    type_name: 'Boeing 737-800',
    type_code: 'B738',
    manufacturer: 'Boeing',
    model: '737-800',
    serial_number: '12345',
    year_built: 2015,
    operator: 'United Airlines',
    operator_icao: 'UAL',
    owner: 'United Airlines Inc',
    country: 'United States',
    registration: 'N12345',
    is_military: false,
    category: 'A3',
    source_data: [{ source: 'FAA', last_updated: '2024-01-01' }],
  };

  const mockPhotoInfo = {
    photo_url: 'https://example.com/photo.jpg',
    thumbnail_url: 'https://example.com/thumb.jpg',
    photographer: 'Test Photographer',
    source: 'planespotters.net',
  };

  describe('empty state', () => {
    it('should render empty state when info is null', () => {
      render(<InfoTab info={null} hex="abc123" />);

      expect(screen.getByText('No aircraft information available')).toBeInTheDocument();
      expect(screen.getByText('Data may not be available for this aircraft')).toBeInTheDocument();
      expect(screen.getByTestId('info-icon')).toBeInTheDocument();
    });

    it('should render empty state when info is undefined', () => {
      render(<InfoTab info={undefined} hex="abc123" />);

      expect(screen.getByText('No aircraft information available')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes for empty state', () => {
      render(<InfoTab info={null} hex="abc123" />);

      const statusElement = screen.getByRole('status');
      expect(statusElement).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    it('should render all card components when info is provided', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      expect(screen.getByTestId('airframe-card')).toBeInTheDocument();
      expect(screen.getByTestId('operator-card')).toBeInTheDocument();
      expect(screen.getByTestId('registration-card')).toBeInTheDocument();
    });

    it('should pass normalized data to AirframeCard', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      expect(screen.getByTestId('airframe-card')).toHaveTextContent('Boeing 737-800');
    });

    it('should pass normalized data to OperatorCard', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      expect(screen.getByTestId('operator-card')).toHaveTextContent('United Airlines');
    });

    it('should pass hex and data to RegistrationCard', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      expect(screen.getByTestId('registration-card')).toHaveTextContent('N12345');
    });
  });

  describe('photo card', () => {
    it('should render PhotoCard when photoInfo is provided', () => {
      render(<InfoTab info={mockInfo} hex="abc123" photoInfo={mockPhotoInfo} />);

      expect(screen.getByTestId('photo-card')).toBeInTheDocument();
      expect(screen.getByTestId('photo-card')).toHaveTextContent('Test Photographer');
    });

    it('should not render PhotoCard when photoInfo is null', () => {
      render(<InfoTab info={mockInfo} hex="abc123" photoInfo={null} />);

      expect(screen.queryByTestId('photo-card')).not.toBeInTheDocument();
    });
  });

  describe('data sources', () => {
    it('should render DataSourcesAccordion when source_data is provided', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      expect(screen.getByTestId('data-sources-accordion')).toBeInTheDocument();
      expect(screen.getByTestId('data-sources-accordion')).toHaveTextContent('1 sources');
    });

    it('should not render DataSourcesAccordion when source_data is empty', () => {
      const infoWithoutSources = { ...mockInfo, source_data: [] };
      render(<InfoTab info={infoWithoutSources} hex="abc123" />);

      expect(screen.queryByTestId('data-sources-accordion')).not.toBeInTheDocument();
    });

    it('should not render DataSourcesAccordion when source_data is undefined', () => {
      const infoWithoutSources = { ...mockInfo, source_data: undefined };
      render(<InfoTab info={infoWithoutSources} hex="abc123" />);

      expect(screen.queryByTestId('data-sources-accordion')).not.toBeInTheDocument();
    });
  });

  describe('data normalization', () => {
    it('should normalize aircraft_type to type_name', () => {
      const alternativeInfo = { aircraft_type: 'Airbus A320' };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      expect(screen.getByTestId('airframe-card')).toHaveTextContent('Airbus A320');
    });

    it('should normalize operatorName to operator', () => {
      const alternativeInfo = { operatorName: 'Delta Air Lines' };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      expect(screen.getByTestId('operator-card')).toHaveTextContent('Delta Air Lines');
    });

    it('should normalize tail_number to registration', () => {
      const alternativeInfo = { tail_number: 'N789DL' };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      expect(screen.getByTestId('registration-card')).toHaveTextContent('N789DL');
    });

    it('should use type field as fallback for type_name', () => {
      const alternativeInfo = { type: 'B77W' };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      expect(screen.getByTestId('airframe-card')).toHaveTextContent('B77W');
    });

    it('should use reg field as fallback for registration', () => {
      const alternativeInfo = { reg: 'G-XLEA' };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      expect(screen.getByTestId('registration-card')).toHaveTextContent('G-XLEA');
    });

    it('should handle yearBuilt alternative field', () => {
      const alternativeInfo = { yearBuilt: 2010 };
      render(<InfoTab info={alternativeInfo} hex="abc123" />);

      // AirframeCard receives the normalized data
      expect(screen.getByTestId('airframe-card')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      render(<InfoTab info={mockInfo} hex="abc123" />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-info');
      expect(tabPanel).toHaveAttribute('id', 'panel-info');
    });
  });

  describe('grid layout', () => {
    it('should render with grid classes', () => {
      const { container } = render(<InfoTab info={mockInfo} hex="abc123" />);

      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toBeInTheDocument();
    });
  });
});

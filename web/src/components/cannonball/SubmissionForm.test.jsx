import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmissionForm } from './SubmissionForm';

describe('SubmissionForm', () => {
  let mockOnSubmit;
  let mockOnCancel;

  beforeEach(() => {
    mockOnSubmit = vi.fn();
    mockOnCancel = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderForm = (props = {}) => {
    return render(<SubmissionForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} {...props} />);
  };

  describe('initial rendering', () => {
    it('should render all required form fields', () => {
      renderForm();

      expect(screen.getByLabelText(/icao hex code/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/agency name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/evidence type/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/evidence description/i)).toBeInTheDocument();
    });

    it('should render optional fields', () => {
      renderForm();

      expect(screen.getByLabelText(/registration.*optional/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/callsign.*optional/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/state.*optional/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/city.*optional/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/evidence url.*optional/i)).toBeInTheDocument();
    });

    it('should render submit and cancel buttons', () => {
      renderForm();

      expect(screen.getByRole('button', { name: /submit for review/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should pre-populate initial ICAO hex', () => {
      renderForm({ initialIcaoHex: 'A12345' });

      expect(screen.getByLabelText(/icao hex code/i)).toHaveValue('A12345');
    });

    it('should pre-populate initial registration', () => {
      renderForm({ initialRegistration: 'N12345' });

      expect(screen.getByLabelText(/registration.*optional/i)).toHaveValue('N12345');
    });
  });

  describe('form validation', () => {
    it('should show error for empty ICAO hex', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      expect(await screen.findByText(/icao hex.*required/i)).toBeInTheDocument();
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should show error for invalid ICAO hex format', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'INVALID');
      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      expect(await screen.findByText(/invalid icao hex format/i)).toBeInTheDocument();
    });

    it('should accept valid ICAO hex formats', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue({ ok: true });
      renderForm();

      // Fill all required fields
      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'This is a detailed description of the evidence that meets the minimum character requirement.'
      );

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });

    it('should show error for empty agency name', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      expect(await screen.findByText(/agency name.*required/i)).toBeInTheDocument();
    });

    it('should show error for short evidence description', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(screen.getByLabelText(/evidence description/i), 'Too short');
      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      expect(await screen.findByText(/at least 50 characters/i)).toBeInTheDocument();
    });

    it('should show error for invalid registration format', async () => {
      const user = userEvent.setup();
      renderForm();

      // Use invalid characters (special chars not allowed by regex /^[A-Z0-9-]{2,10}$/i)
      // Also fill in required fields to ensure we get to registration validation
      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'Test Agency');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'This is test evidence description that meets the minimum character requirement.'
      );
      await user.type(screen.getByLabelText(/registration.*optional/i), 'N@#$%');
      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      expect(await screen.findByText(/invalid registration format/i)).toBeInTheDocument();
    });

    it('should show error for invalid evidence URL', async () => {
      const user = userEvent.setup();
      renderForm();

      // Just fill the URL field with invalid value and submit
      // We'll get validation errors for required fields AND the URL format error
      await user.type(screen.getByLabelText(/evidence url.*optional/i), 'ftp://not-http-url.com');
      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      // Should show URL error even if required field errors also appear
      expect(await screen.findByText(/url must start with http/i)).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('should call onSubmit with form data', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue({ ok: true });
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'a12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'Observed this aircraft circling over a residential area for an extended period.'
      );
      await user.type(screen.getByLabelText(/registration.*optional/i), 'n12345');

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            icaoHex: 'A12345', // Should be uppercase
            agencyName: 'FBI',
            registration: 'N12345', // Should be uppercase
            evidenceType: 'flight_pattern',
          })
        );
      });
    });

    it('should show loading state during submission', async () => {
      mockOnSubmit.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100))
      );
      renderForm({ loading: true });

      expect(screen.getByText(/submitting/i)).toBeInTheDocument();
    });

    it('should show success message after submission', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue({ ok: true });
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'Observed this aircraft circling over a residential area for an extended period.'
      );

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      await waitFor(() => {
        expect(screen.getByText(/submission received/i)).toBeInTheDocument();
      });
    });

    it('should show Submit Another button after success', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue({ ok: true });
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'Observed this aircraft circling over a residential area for an extended period.'
      );

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /submit another/i })).toBeInTheDocument();
      });
    });

    it('should reset form when Submit Another is clicked', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue({ ok: true });
      renderForm();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');
      await user.type(screen.getByLabelText(/agency name/i), 'FBI');
      await user.type(
        screen.getByLabelText(/evidence description/i),
        'Observed this aircraft circling over a residential area for an extended period.'
      );

      await user.click(screen.getByRole('button', { name: /submit for review/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /submit another/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /submit another/i }));

      expect(screen.getByLabelText(/icao hex code/i)).toHaveValue('');
      expect(screen.getByLabelText(/agency name/i)).toHaveValue('');
    });
  });

  describe('error handling', () => {
    it('should display error prop', () => {
      renderForm({ error: 'Something went wrong' });

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should clear validation error when field is changed', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole('button', { name: /submit for review/i }));
      expect(await screen.findByText(/icao hex.*required/i)).toBeInTheDocument();

      await user.type(screen.getByLabelText(/icao hex code/i), 'A12345');

      await waitFor(() => {
        expect(screen.queryByText(/icao hex.*required/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('cancel button', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should not render cancel button if onCancel is not provided', () => {
      render(<SubmissionForm onSubmit={mockOnSubmit} />);

      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });
  });

  describe('evidence type selection', () => {
    it('should have flight_pattern as default evidence type', () => {
      renderForm();

      expect(screen.getByLabelText(/evidence type/i)).toHaveValue('flight_pattern');
    });

    it('should allow selecting different evidence types', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(screen.getByLabelText(/evidence type/i), 'foia');

      expect(screen.getByLabelText(/evidence type/i)).toHaveValue('foia');
    });
  });

  describe('agency type selection', () => {
    it('should have unknown as default agency type', () => {
      renderForm();

      expect(screen.getByLabelText(/agency type/i)).toHaveValue('unknown');
    });

    it('should allow selecting different agency types', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(screen.getByLabelText(/agency type/i), 'federal');

      expect(screen.getByLabelText(/agency type/i)).toHaveValue('federal');
    });
  });

  describe('state selection', () => {
    it('should render state dropdown with all US states', async () => {
      const user = userEvent.setup();
      renderForm();

      const stateSelect = screen.getByLabelText(/state.*optional/i);
      await user.selectOptions(stateSelect, 'CA');

      expect(stateSelect).toHaveValue('CA');
    });
  });

  describe('character counter', () => {
    it('should show character count for evidence description', async () => {
      const user = userEvent.setup();
      renderForm();

      await user.type(screen.getByLabelText(/evidence description/i), 'Hello');

      expect(screen.getByText(/5 \/ 50 characters minimum/i)).toBeInTheDocument();
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertsScreen } from './AlertsScreen';
import {
  buildConditionsPayload,
  buildRulePayload,
  matchCount,
  ruleCondSummary,
  ruleToForm,
  priorityConfig,
} from './alertsModel';

const mockHandleToggle = vi.fn();
const mockHandleDelete = vi.fn();
const mockHandleUndoDelete = vi.fn();
const mockRefetch = vi.fn();
let mockRules = [];
let mockPendingDelete = null;

vi.mock('../../../../hooks/useAlertRules', () => ({
  useAlertRules: () => ({
    rules: mockRules,
    filteredRules: mockRules,
    realtimeAlerts: [],
    refetch: mockRefetch,
    searchQuery: '',
    setSearchQuery: vi.fn(),
    priorityFilter: 'all',
    setPriorityFilter: vi.fn(),
    statusFilter: 'all',
    setStatusFilter: vi.fn(),
    handleToggle: mockHandleToggle,
    handleDelete: mockHandleDelete,
    handleUndoDelete: mockHandleUndoDelete,
    pendingDelete: mockPendingDelete,
  }),
}));

describe('alertsModel', () => {
  it('buildConditionsPayload maps design labels to backend types/ops', () => {
    const payload = buildConditionsPayload([{ field: 'Altitude', op: 'less than', val: '1000' }]);
    expect(payload).toEqual({
      logic: 'AND',
      groups: [
        {
          logic: 'AND',
          conditions: [{ type: 'altitude', operator: 'lt', value: '1000' }],
        },
      ],
    });
  });

  it('in list compiles to an anchored regex', () => {
    const payload = buildConditionsPayload([
      { field: 'Squawk', op: 'in list', val: '7500, 7600,7700' },
    ]);
    expect(payload.groups[0].conditions[0]).toEqual({
      type: 'squawk',
      operator: 'regex',
      value: '^(7500|7600|7700)$',
    });
  });

  it('Aircraft Class multiselect compiles to an anchored class regex', () => {
    const payload = buildConditionsPayload([
      { field: 'Aircraft Class', op: 'is any of', val: 'military,police,fire' },
    ]);
    expect(payload.groups[0].conditions[0]).toEqual({
      type: 'class',
      operator: 'regex',
      value: '^(military|police|fire)$',
    });
  });

  it('Aircraft Class round-trips a stored rule back to the multiselect', () => {
    const form = ruleToForm({
      name: 'Public Safety',
      conditions: {
        logic: 'AND',
        groups: [{ conditions: [{ type: 'class', operator: 'regex', value: '^(fire|police)$' }] }],
      },
    });
    expect(form.conds).toEqual([{ field: 'Aircraft Class', op: 'is any of', val: 'fire,police' }]);
  });

  it('matchCount classifies live aircraft for the class filter', () => {
    const fleet = [
      { hex: 'm1', military: true },
      { hex: 'g1', category: 'A1' },
      { hex: 'c1', category: 'A5', flight: 'UAL1' },
    ];
    const cond = [{ field: 'Aircraft Class', op: 'is any of', val: 'military,ga' }];
    expect(matchCount(fleet, cond)).toBe(2);
  });

  it('buildRulePayload converts cooldown seconds to minutes', () => {
    const p = buildRulePayload({
      name: ' My Rule ',
      priority: 'warning',
      conds: [{ field: 'Distance', op: 'less than', val: '5' }],
      cooldownSeconds: '300',
      enabled: true,
    });
    expect(p.name).toBe('My Rule');
    expect(p.cooldown_minutes).toBe(5);
    expect(p.priority).toBe('warning');
  });

  it('matchCount evaluates conditions against live aircraft', () => {
    const fleet = [
      { hex: 'a1', alt: 500, gs: 100, distance_nm: 2 },
      { hex: 'a2', alt: 5000, gs: 300, distance_nm: 12 },
    ];
    expect(matchCount(fleet, [{ field: 'Altitude', op: 'less than', val: '1000' }])).toBe(1);
    expect(matchCount(fleet, [{ field: 'ICAO Hex', op: 'equals', val: 'A2' }])).toBe(1);
    expect(matchCount(fleet, [{ field: 'ICAO Hex', op: 'equals', val: '' }])).toBe(0);
  });

  it('ruleCondSummary renders complex conditions and legacy simple rules', () => {
    expect(
      ruleCondSummary({
        conditions: {
          logic: 'AND',
          groups: [{ conditions: [{ type: 'altitude', operator: 'lt', value: '1000' }] }],
        },
      })
    ).toBe('altitude lt 1000');
    expect(ruleCondSummary({ rule_type: 'squawk', operator: 'eq', value: '7700' })).toBe(
      'squawk eq 7700'
    );
  });

  it('priorityConfig falls back to info', () => {
    expect(priorityConfig('nonsense').label).toBe('INFO');
    expect(priorityConfig('emergency').label).toBe('EMERGENCY');
  });
});

describe('AlertsScreen', () => {
  beforeEach(() => {
    mockRules = [
      {
        id: 1,
        name: 'Emergency Squawk',
        priority: 'emergency',
        enabled: true,
        description: 'Distress codes',
        conditions: {
          logic: 'AND',
          groups: [
            { conditions: [{ type: 'squawk', operator: 'regex', value: '^(7500|7600|7700)$' }] },
          ],
        },
        trigger_count: 3,
      },
      { id: 2, name: 'Nearby Aircraft', priority: 'info', enabled: false, description: 'Close by' },
    ];
    mockPendingDelete = null;
    mockHandleDelete.mockClear();
    mockHandleUndoDelete.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve([]),
    });
  });

  const renderScreen = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <AlertsScreen apiBase="" wsRequest={vi.fn()} wsConnected aircraft={[]} {...props} />
      </QueryClientProvider>
    );
  };

  it('renders rule cards with priority pills and condition summary', () => {
    renderScreen();
    expect(screen.getByText('Emergency Squawk')).toBeInTheDocument();
    expect(screen.getByText('EMERGENCY')).toBeInTheDocument();
    expect(screen.getByText('squawk regex ^(7500|7600|7700)$')).toBeInTheDocument();
  });

  it('toggle switch calls handleToggle with the rule', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Nearby Aircraft' }));
    expect(mockHandleToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('opens the create-rule modal and creates via wsRequest', async () => {
    const wsRequest = vi.fn().mockResolvedValue({ id: 99 });
    renderScreen({ wsRequest });
    fireEvent.click(screen.getByTestId('v2-alerts-new-rule'));
    expect(screen.getByText('Quick Start Templates')).toBeInTheDocument();
    // Apply a template then create
    fireEvent.click(screen.getByText('Military Aircraft'));
    fireEvent.click(screen.getByText('Create Rule'));
    await waitFor(() =>
      expect(wsRequest).toHaveBeenCalledWith('alert-rule-create', expect.any(Object))
    );
    const payload = wsRequest.mock.calls[0][1];
    expect(payload.name).toBe('Military Aircraft Alert');
    expect(payload.priority).toBe('warning');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('switches to notifications tab with local sink + channel manager', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }));
    expect(screen.getByText('Local Sink')).toBeInTheDocument();
    expect(screen.getByText('Play sound')).toBeInTheDocument();
    expect(screen.getByText('Notification Channels')).toBeInTheDocument();
  });

  it('switches to history tab and shows empty state', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: /History/ }));
    await waitFor(() => expect(screen.getByText('No alerts fired yet')).toBeInTheDocument());
  });

  it('shows the inbox tab empty state', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: /Inbox/ }));
    await waitFor(() =>
      expect(screen.getByText('Inbox empty — no alerts received yet')).toBeInTheDocument()
    );
  });

  it('edit button opens the modal prefilled from the rule and updates via wsRequest', async () => {
    const wsRequest = vi.fn().mockResolvedValue({ id: 1 });
    renderScreen({ wsRequest });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Emergency Squawk' }));
    // Edit mode: prefilled name + Save Changes button (title uses a Radix
    // asChild wrapper that getByText can't match cleanly).
    expect(screen.getByLabelText('Rule name').value).toBe('Emergency Squawk');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() =>
      expect(wsRequest).toHaveBeenCalledWith(
        'alert-rule-update',
        expect.objectContaining({ id: 1 })
      )
    );
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('delete button calls handleDelete with the rule', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Nearby Aircraft' }));
    expect(mockHandleDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it('shows an undo bar while a delete is pending', () => {
    mockPendingDelete = { rule: mockRules[1], timestamp: 1 };
    renderScreen();
    expect(screen.getByText(/deleted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mockHandleUndoDelete).toHaveBeenCalled();
  });
});

import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

/**
 * The Tabs component is built on Radix UI primitives and provides a tabbed
 * interface for organizing content into separate views. Only one view is
 * visible at a time.
 *
 * ## Features
 * - **Keyboard accessible**: Full keyboard navigation with arrow keys
 * - **Horizontal/Vertical orientation**: Supports both layout directions
 * - **Controlled/Uncontrolled**: Can be used with or without state management
 * - **Customizable**: Accepts className props for styling
 */
export default {
  title: 'UI/Tabs',
  component: Tabs,
  subcomponents: { TabsList, TabsTrigger, TabsContent },
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An accessible tabs component built on Radix UI primitives for organizing content into switchable panels.',
      },
    },
  },
  argTypes: {
    defaultValue: {
      control: 'text',
      description: 'The value of the tab to select by default',
    },
    orientation: {
      control: 'radio',
      options: ['horizontal', 'vertical'],
      description: 'The orientation of the tabs',
      table: {
        defaultValue: { summary: 'horizontal' },
      },
    },
    activationMode: {
      control: 'radio',
      options: ['automatic', 'manual'],
      description:
        'When automatic, tabs are activated upon focus. When manual, tabs are activated upon click.',
      table: {
        defaultValue: { summary: 'automatic' },
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: '500px', maxWidth: '100%' }}>
        <Story />
      </div>
    ),
  ],
};

// Sample tab data for stories
const tabItems = [
  {
    value: 'overview',
    label: 'Overview',
    content:
      'View real-time aircraft positions on an interactive map with filtering and search capabilities.',
  },
  {
    value: 'alerts',
    label: 'Alerts',
    content:
      'Configure custom alert rules based on aircraft type, altitude, squawk codes, and more.',
  },
  {
    value: 'history',
    label: 'History',
    content:
      'Browse historical flight data and replay past aircraft movements with detailed statistics.',
  },
];

/**
 * The default tabs configuration with horizontal layout. Click or use
 * arrow keys to navigate between tabs.
 */
export const Default = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        {tabItems.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabItems.map((item) => (
        <TabsContent key={item.value} value={item.value}>
          <div className="p-4 bg-bg-card rounded-lg">
            <p className="text-text-secondary">{item.content}</p>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  ),
  args: {
    defaultValue: 'overview',
  },
};

/**
 * Tabs with icons in the triggers for enhanced visual recognition.
 * Icons can be placed before or after the label text.
 */
export const WithIcons = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="aircraft" className="gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
          Aircraft
        </TabsTrigger>
        <TabsTrigger value="alerts" className="gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          Alerts
        </TabsTrigger>
        <TabsTrigger value="settings" className="gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="aircraft">
        <div className="p-4 bg-bg-card rounded-lg">
          <h3 className="text-text-primary font-medium mb-2">Aircraft Tracking</h3>
          <p className="text-text-secondary">
            Monitor aircraft in real-time with position updates every second.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="alerts">
        <div className="p-4 bg-bg-card rounded-lg">
          <h3 className="text-text-primary font-medium mb-2">Alert Management</h3>
          <p className="text-text-secondary">
            Configure notifications for specific aircraft or flight conditions.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="settings">
        <div className="p-4 bg-bg-card rounded-lg">
          <h3 className="text-text-primary font-medium mb-2">System Settings</h3>
          <p className="text-text-secondary">
            Customize your SkySpy experience with display and notification preferences.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
  args: {
    defaultValue: 'aircraft',
  },
};

/**
 * Individual tabs can be disabled to prevent user interaction while
 * keeping them visible in the interface.
 */
export const DisabledTab = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="active">Active Tab</TabsTrigger>
        <TabsTrigger value="disabled" disabled>
          Disabled Tab
        </TabsTrigger>
        <TabsTrigger value="another">Another Tab</TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            This is the active tab content. The middle tab is disabled and cannot be selected.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="disabled">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            This content is not accessible because the tab is disabled.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="another">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            This is another accessible tab with its own content.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
  args: {
    defaultValue: 'active',
  },
};

/**
 * Vertical orientation arranges tabs in a column. Use the up/down arrow
 * keys to navigate between tabs in this mode.
 */
export const VerticalOrientation = {
  render: (args) => (
    <Tabs {...args}>
      <div className="flex gap-4">
        <TabsList className="flex-col h-auto">
          <TabsTrigger value="profile" className="w-full justify-start">
            Profile
          </TabsTrigger>
          <TabsTrigger value="account" className="w-full justify-start">
            Account
          </TabsTrigger>
          <TabsTrigger value="notifications" className="w-full justify-start">
            Notifications
          </TabsTrigger>
          <TabsTrigger value="security" className="w-full justify-start">
            Security
          </TabsTrigger>
        </TabsList>
        <div className="flex-1">
          <TabsContent value="profile" className="mt-0">
            <div className="p-4 bg-bg-card rounded-lg">
              <h3 className="text-text-primary font-medium mb-2">Profile Settings</h3>
              <p className="text-text-secondary">
                Manage your display name, avatar, and public profile.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="account" className="mt-0">
            <div className="p-4 bg-bg-card rounded-lg">
              <h3 className="text-text-primary font-medium mb-2">Account Settings</h3>
              <p className="text-text-secondary">
                Update your email, password, and account preferences.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="notifications" className="mt-0">
            <div className="p-4 bg-bg-card rounded-lg">
              <h3 className="text-text-primary font-medium mb-2">Notification Preferences</h3>
              <p className="text-text-secondary">
                Configure which alerts you want to receive and how.
              </p>
            </div>
          </TabsContent>
          <TabsContent value="security" className="mt-0">
            <div className="p-4 bg-bg-card rounded-lg">
              <h3 className="text-text-primary font-medium mb-2">Security Settings</h3>
              <p className="text-text-secondary">
                Manage two-factor authentication and active sessions.
              </p>
            </div>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  ),
  args: {
    defaultValue: 'profile',
    orientation: 'vertical',
  },
};

/**
 * Use the defaultValue prop to specify which tab should be selected
 * when the component first renders.
 */
export const DefaultValueSelection = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="first">First Tab</TabsTrigger>
        <TabsTrigger value="second">Second Tab</TabsTrigger>
        <TabsTrigger value="third">Third Tab</TabsTrigger>
      </TabsList>
      <TabsContent value="first">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">Content for the first tab.</p>
        </div>
      </TabsContent>
      <TabsContent value="second">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            This tab is selected by default using the defaultValue prop.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="third">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">Content for the third tab.</p>
        </div>
      </TabsContent>
    </Tabs>
  ),
  args: {
    defaultValue: 'second',
  },
};

/**
 * Tabs can contain rich content including forms, data tables, and
 * other interactive elements.
 */
export const RichContent = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="stats">Statistics</TabsTrigger>
        <TabsTrigger value="list">Aircraft List</TabsTrigger>
        <TabsTrigger value="form">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="stats">
        <div className="p-4 bg-bg-card rounded-lg">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-cyan">1,234</div>
              <div className="text-xs text-text-dim">Aircraft Tracked</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-accent-green">156</div>
              <div className="text-xs text-text-dim">Active Alerts</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-status-warning">42</div>
              <div className="text-xs text-text-dim">Military</div>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="list">
        <div className="p-4 bg-bg-card rounded-lg">
          <div className="space-y-2">
            {['N12345 - Boeing 737', 'N67890 - Airbus A320', 'N11111 - Cessna 172'].map(
              (aircraft) => (
                <div
                  key={aircraft}
                  className="flex items-center justify-between p-2 bg-bg-hover rounded"
                >
                  <span className="text-text-primary text-sm">{aircraft}</span>
                  <span className="text-accent-cyan text-xs">12,500 ft</span>
                </div>
              )
            )}
          </div>
        </div>
      </TabsContent>
      <TabsContent value="form">
        <div className="p-4 bg-bg-card rounded-lg space-y-3">
          <div>
            <label htmlFor="refresh-rate-select" className="text-text-secondary text-sm block mb-1">
              Refresh Rate
            </label>
            <select
              id="refresh-rate-select"
              className="w-full bg-bg-hover text-text-primary rounded px-3 py-2 text-sm"
            >
              <option>1 second</option>
              <option>5 seconds</option>
              <option>10 seconds</option>
            </select>
          </div>
          <div>
            <label htmlFor="max-range-input" className="text-text-secondary text-sm block mb-1">
              Max Range (nm)
            </label>
            <input
              id="max-range-input"
              type="number"
              defaultValue="250"
              className="w-full bg-bg-hover text-text-primary rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      </TabsContent>
    </Tabs>
  ),
  args: {
    defaultValue: 'stats',
  },
};

/**
 * Manual activation mode requires clicking to change tabs rather than
 * just focusing with keyboard navigation.
 */
export const ManualActivation = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="tab1">Tab One</TabsTrigger>
        <TabsTrigger value="tab2">Tab Two</TabsTrigger>
        <TabsTrigger value="tab3">Tab Three</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            With manual activation, use Tab key to navigate triggers, then press Enter or Space to
            activate.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="tab2">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">This tab must be explicitly clicked or activated.</p>
        </div>
      </TabsContent>
      <TabsContent value="tab3">
        <div className="p-4 bg-bg-card rounded-lg">
          <p className="text-text-secondary">
            Useful when tab changes trigger expensive operations.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  ),
  args: {
    defaultValue: 'tab1',
    activationMode: 'manual',
  },
  parameters: {
    docs: {
      description: {
        story:
          'In manual activation mode, tabs are not activated on focus. Users must click or press Enter/Space to switch tabs. This is useful when changing tabs triggers expensive data fetching.',
      },
    },
  },
};

/**
 * All tab variants displayed together for visual comparison.
 */
export const AllVariants = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
          Default Tabs
        </h3>
        <Tabs defaultValue="tab1">
          <TabsList>
            <TabsTrigger value="tab1">Tab One</TabsTrigger>
            <TabsTrigger value="tab2">Tab Two</TabsTrigger>
            <TabsTrigger value="tab3">Tab Three</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">First tab content</p>
            </div>
          </TabsContent>
          <TabsContent value="tab2">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Second tab content</p>
            </div>
          </TabsContent>
          <TabsContent value="tab3">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Third tab content</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
          With Disabled Tab
        </h3>
        <Tabs defaultValue="enabled1">
          <TabsList>
            <TabsTrigger value="enabled1">Enabled</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Disabled
            </TabsTrigger>
            <TabsTrigger value="enabled2">Enabled</TabsTrigger>
          </TabsList>
          <TabsContent value="enabled1">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">First enabled tab</p>
            </div>
          </TabsContent>
          <TabsContent value="enabled2">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Second enabled tab</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div>
        <h3 style={{ color: '#8b949e', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
          With Icons
        </h3>
        <Tabs defaultValue="home">
          <TabsList>
            <TabsTrigger value="home" className="gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Home
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              Map
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Stats
            </TabsTrigger>
          </TabsList>
          <TabsContent value="home">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Home content</p>
            </div>
          </TabsContent>
          <TabsContent value="map">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Map content</p>
            </div>
          </TabsContent>
          <TabsContent value="stats">
            <div className="p-4 bg-bg-card rounded-lg">
              <p className="text-text-secondary">Stats content</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  ),
  parameters: {
    layout: 'padded',
  },
};

import type { Preview } from '@storybook/react-vite'
import React from 'react'

// Import project CSS files
import '../src/styles/base.css'
import '../src/styles/components.css'
import '../src/styles/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        {
          name: 'dark',
          value: '#0d1117',
        },
        {
          name: 'card',
          value: '#151b24',
        },
      ],
    },
  },
  decorators: [
    (Story) => (
      React.createElement('div', {
        style: {
          backgroundColor: '#0d1117',
          padding: '1rem',
          minHeight: '100vh',
        },
      }, React.createElement(Story))
    ),
  ],
};

export default preview;

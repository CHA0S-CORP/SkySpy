/**
 * Accessibility utilities for development-time a11y testing
 */

/**
 * Initialize axe-core accessibility testing in development mode.
 * This is a no-op in production and handles errors gracefully.
 *
 * @returns {Promise<void>}
 */
export async function initA11y() {
  // Only run in development mode
  if (!import.meta.env.DEV) {
    return;
  }

  try {
    // Dynamically import axe-core/react to avoid bundling in production
    const axe = await import('@axe-core/react');
    const React = await import('react');
    const ReactDOM = await import('react-dom');

    // Configure axe with specific accessibility rules
    const config = {
      rules: [
        { id: 'color-contrast', enabled: true },
        { id: 'label', enabled: true },
        { id: 'button-name', enabled: true },
        { id: 'image-alt', enabled: true },
      ],
    };

    // Initialize axe with React and ReactDOM
    axe.default(React, ReactDOM, 1000, config);
  } catch (error) {
    // Gracefully handle any errors during initialization
    console.warn('[a11y] Failed to initialize axe-core:', error.message);
  }
}

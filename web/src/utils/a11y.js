/**
 * Accessibility utilities for development-time a11y testing
 */

/**
 * Initialize axe-core accessibility testing in development mode.
 * This is a no-op in production and handles errors gracefully.
 *
 * Note: @axe-core/react is an optional devDependency. If not installed,
 * this function silently does nothing.
 *
 * @returns {Promise<void>}
 */
export async function initA11y() {
  // Only run in development mode
  if (!import.meta.env.DEV) {
    return;
  }

  // Skip if running in Docker or CI where devDependencies may not be installed
  if (import.meta.env.VITE_SKIP_A11Y) {
    return;
  }

  try {
    // Dynamically import optional dependencies
    // These imports may fail if the packages are not installed (e.g., in production)
    let axeModule, React, ReactDOM;
    try {
      [axeModule, React, ReactDOM] = await Promise.all([
        import('@axe-core/react').catch(() => null),
        import('react'),
        import('react-dom'),
      ]);
    } catch {
      // Packages not available, silently skip
      return;
    }

    // If axe-core is not available, silently skip
    if (!axeModule) {
      return;
    }

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
    axeModule.default(React, ReactDOM, 1000, config);
  } catch {
    // Silently ignore - a11y testing is optional
  }
}

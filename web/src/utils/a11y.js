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
    // Use Function constructor to prevent Vite from statically analyzing this import
    // This allows the code to work even when @axe-core/react is not installed
    const dynamicImport = new Function('specifier', 'return import(specifier)');

    const [axeModule, React, ReactDOM] = await Promise.all([
      dynamicImport('@axe-core/react').catch(() => null),
      dynamicImport('react'),
      dynamicImport('react-dom'),
    ]);

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

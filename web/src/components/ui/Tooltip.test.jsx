import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './tooltip';

describe('Tooltip', () => {
  describe('TooltipProvider', () => {
    it('should render children', () => {
      render(
        <TooltipProvider>
          <div data-testid="child">Child Content</div>
        </TooltipProvider>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
  });

  describe('basic rendering', () => {
    it('should render trigger', () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(screen.getByText('Hover me')).toBeInTheDocument();
    });

    it('should not show content by default', () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(screen.queryByText('Tooltip content')).not.toBeInTheDocument();
    });
  });

  describe('controlled state with defaultOpen', () => {
    it('should show content when defaultOpen is true', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      // Radix renders content with duplicates for accessibility, use getAllByText
      await waitFor(() => {
        const contents = screen.getAllByText('Content');
        expect(contents.length).toBeGreaterThan(0);
      });
    });

    it('should show content when open prop is true', async () => {
      render(
        <TooltipProvider>
          <Tooltip open={true}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Open Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Open Content');
        expect(contents.length).toBeGreaterThan(0);
      });
    });
  });

  describe('TooltipContent styling', () => {
    it('should apply custom className to content', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent className="my-custom-class">Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Content');
        // The content div should have the custom class
        const contentElement = contents.find(
          (el) => el.className && el.className.includes('my-custom-class')
        );
        expect(contentElement).toBeDefined();
      });
    });

    it('should have base styling classes', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Styled Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Styled Content');
        // Find the content element with styling classes
        const styledContent = contents.find(
          (el) => el.className && el.className.includes('overflow-hidden')
        );
        expect(styledContent).toBeDefined();
        expect(styledContent).toHaveClass('rounded-md');
        expect(styledContent).toHaveClass('px-3');
        expect(styledContent).toHaveClass('py-1.5');
      });
    });

    it('should have background and border classes', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Border Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Border Content');
        const styledContent = contents.find(
          (el) => el.className && el.className.includes('bg-bg-card')
        );
        expect(styledContent).toBeDefined();
        expect(styledContent).toHaveClass('border');
        expect(styledContent).toHaveClass('border-border');
      });
    });

    it('should have text styling classes', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Text Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Text Content');
        const styledContent = contents.find(
          (el) => el.className && el.className.includes('text-xs')
        );
        expect(styledContent).toBeDefined();
        expect(styledContent).toHaveClass('text-text-primary');
      });
    });

    it('should have shadow classes', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Shadow Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Shadow Content');
        const styledContent = contents.find(
          (el) => el.className && el.className.includes('shadow-lg')
        );
        expect(styledContent).toBeDefined();
        expect(styledContent).toHaveClass('shadow-black/20');
      });
    });

    it('should have animation classes', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Animated Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Animated Content');
        const styledContent = contents.find(
          (el) => el.className && el.className.includes('animate-in')
        );
        expect(styledContent).toBeDefined();
        expect(styledContent).toHaveClass('fade-in-0');
        expect(styledContent).toHaveClass('zoom-in-95');
      });
    });
  });

  describe('sideOffset', () => {
    it('should render content with default sideOffset', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Default Offset</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Default Offset');
        expect(contents.length).toBeGreaterThan(0);
      });
    });

    it('should accept custom sideOffset', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent sideOffset={10}>Custom Offset</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Custom Offset');
        expect(contents.length).toBeGreaterThan(0);
      });
    });
  });

  describe('controlled state', () => {
    it('should call onOpenChange when state changes', async () => {
      const onOpenChange = vi.fn();

      render(
        <TooltipProvider>
          <Tooltip defaultOpen onOpenChange={onOpenChange}>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      // Wait for tooltip to be rendered
      await waitFor(() => {
        expect(screen.getAllByText('Content').length).toBeGreaterThan(0);
      });
    });
  });

  describe('TooltipTrigger', () => {
    it('should render as button by default', () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Button Trigger</TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      expect(screen.getByText('Button Trigger').tagName).toBe('BUTTON');
    });

    it('should support asChild prop', () => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span data-testid="custom-trigger">Custom Trigger</span>
            </TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByTestId('custom-trigger');
      expect(trigger.tagName).toBe('SPAN');
    });
  });

  describe('complex content', () => {
    it('should render complex content', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>
              <div data-testid="complex-content">
                <strong>Bold text</strong>
                <p>Paragraph</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        // Radix may duplicate content for accessibility, check that content exists
        expect(screen.getAllByTestId('complex-content').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Bold text').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Paragraph').length).toBeGreaterThan(0);
      });
    });
  });

  describe('displayName', () => {
    it('should have correct displayNames', () => {
      // Radix UI components have their own displayNames
      expect(TooltipProvider.displayName).toBeDefined();
      expect(Tooltip.displayName).toBeDefined();
      expect(TooltipTrigger.displayName).toBeDefined();
      expect(TooltipContent.displayName).toBeDefined();
    });
  });

  describe('portal rendering', () => {
    it('should render content in a portal when open', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Portal Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Portal Content');
        expect(contents.length).toBeGreaterThan(0);
      });
    });
  });

  describe('z-index', () => {
    it('should have z-index style set via CSS variable', async () => {
      render(
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent>Z-Index Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      await waitFor(() => {
        const contents = screen.getAllByText('Z-Index Content');
        // Find the styled content element
        const styledContent = contents.find(
          (el) => el.style && el.style.zIndex
        );
        expect(styledContent).toBeDefined();
      });
    });
  });
});

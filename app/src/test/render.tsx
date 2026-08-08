import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

export type BkemoTheme = 'dark' | 'light';
export type BkemoPreset = 'coffee' | 'developer' | 'dusk';
export type BkemoDensity = 'compact' | 'regular' | 'comfy';

export type RenderBkemoOptions = Omit<RenderOptions, 'wrapper'> & {
  /** Initial MemoryRouter entries. Default: `['/']`. */
  route?: string | string[];
  theme?: BkemoTheme;
  preset?: BkemoPreset;
  density?: BkemoDensity;
  accent?: string;
  /** Wrap in MemoryRouter. Default true. */
  router?: boolean;
};

function BkemoShell({
  children,
  theme,
  preset,
  density,
  accent,
}: {
  children: ReactNode;
  theme: BkemoTheme;
  preset: BkemoPreset;
  density: BkemoDensity;
  accent?: string;
}) {
  return (
    <div
      className="bkemo"
      data-theme={theme}
      data-preset={preset}
      data-density={density}
      style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Render product UI under the `.bkemo` token scope used in production.
 * Prefer this over bare `render` for component / interaction tests.
 */
export function renderBkemo(ui: ReactElement, options: RenderBkemoOptions = {}): RenderResult {
  const {
    route = '/',
    theme = 'dark',
    preset = 'dusk',
    density = 'regular',
    accent,
    router = true,
    ...rest
  } = options;

  const entries = Array.isArray(route) ? route : [route];

  const Wrapper = ({ children }: { children: ReactNode }) => {
    const shell = (
      <BkemoShell theme={theme} preset={preset} density={density} accent={accent}>
        {children}
      </BkemoShell>
    );
    if (!router) return shell;
    return <MemoryRouter initialEntries={entries}>{shell}</MemoryRouter>;
  };

  return render(ui, { wrapper: Wrapper, ...rest });
}

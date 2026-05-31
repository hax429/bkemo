import { observer } from 'mobx-react-lite';
import { ReactNode, CSSProperties } from 'react';

export type Density = 'compact' | 'regular' | 'comfy';

/**
 * Root surface for the Direction D UI. Applies the `.bkemo` token scope plus
 * density and accent overrides (sourced from settings/localStorage). Everything
 * inside reads the CSS variables defined in styles/bkemo-theme.css.
 */
export const BkemoLayout = observer(function BkemoLayout({
  children,
  density = 'regular',
  accent,
  theme = 'dark',
}: {
  children: ReactNode;
  density?: Density;
  accent?: string;
  theme?: 'dark' | 'light';
}) {
  return (
    <div
      className="bkemo"
      data-density={density}
      data-theme={theme}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflow: 'hidden',
        ...(accent ? { ['--accent' as any]: accent } : {}),
      } as CSSProperties}
    >
      {children}
    </div>
  );
});

import { observer } from 'mobx-react-lite';
import { ReactNode, CSSProperties } from 'react';

export type Density = 'compact' | 'regular' | 'comfy';

/**
 * Root surface for the bkemo UI. Applies the `.bkemo` token scope plus
 * density and accent overrides (sourced from settings/localStorage). Everything
 * inside reads the CSS variables defined in styles/bkemo-theme.css.
 */
export const BkemoLayout = observer(function BkemoLayout({
  children,
  density = 'regular',
  accent,
  theme = 'dark',
  bgGradient = 'none',
}: {
  children: ReactNode;
  density?: Density;
  accent?: string;
  theme?: 'dark' | 'light';
  bgGradient?: 'none' | 'dusk' | 'warm' | 'aurora';
}) {
  // Determine gradient background styling
  let backgroundStyle = {};
  if (theme === 'dark') {
    if (bgGradient === 'dusk') {
      backgroundStyle = {
        background: 'radial-gradient(1100px 480px at 30% -8%, rgba(226,169,107,0.07), transparent 60%), radial-gradient(900px 520px at 92% 0%, rgba(140,143,230,0.06), transparent 55%), var(--bg)',
      };
    } else if (bgGradient === 'warm') {
      backgroundStyle = {
        background: 'radial-gradient(1200px 600px at 20% -10%, #1c1812, transparent 60%), radial-gradient(1000px 700px at 95% 110%, #14130f, transparent 55%), var(--bg)',
      };
    } else if (bgGradient === 'aurora') {
      backgroundStyle = {
        background: 'radial-gradient(1000px 500px at 10% -5%, rgba(94,106,210,0.12), transparent 55%), radial-gradient(800px 600px at 90% 105%, rgba(164,94,224,0.1), transparent 50%), var(--bg)',
      };
    }
  }

  // Match active preset theme
  const preset = theme === 'light' ? 'light' : (accent?.toLowerCase() === '#5e6ad2' ? 'developer' : (accent?.toLowerCase() === '#e2a96b' ? 'coffee' : 'dusk'));

  return (
    <div
      className="bkemo"
      data-density={density}
      data-theme={theme}
      data-preset={preset}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflow: 'hidden',
        ...(accent ? { ['--accent' as any]: accent } : {}),
        ...backgroundStyle,
      } as CSSProperties}
    >
      {children}
    </div>
  );
});

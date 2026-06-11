import { ReactNode, Component, ErrorInfo } from 'react';
import React from 'react'
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react';
import * as reactSpring from '@react-spring/three'
import { RootStore } from '@/store/root';
import { BlinkoStore } from '@/store/blinkoStore';
import { cn } from '@heroui/react';
import { loadPrefs } from '@/lib/bkemoSettings';

/** Mix a hex color toward white by `amt` (0..1). */
function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

class GradientErrorBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false };
  
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log('ShaderGradient error caught:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <div className="w-full h-full absolute top-0 left-0 bg-gradient-to-br from-blue-500 to-purple-600" />;
    }
    
    return this.props.children;
  }
}

interface GradientBackgroundProps {
  children: ReactNode;
  className?: string;
  /** Override the bkemo accent (defaults to the saved appearance pref). */
  accent?: string;
  /** Override the bkemo theme (defaults to the saved appearance pref). */
  theme?: 'dark' | 'light';
}

export const GradientBackground = ({ children, className, accent, theme }: GradientBackgroundProps) => {
  const blinko = RootStore.Get(BlinkoStore)

  // Drive the animated gradient from the user's bkemo accent + theme so the
  // login / share backgrounds match the rest of the app instead of using a
  // fixed Blinko palette.
  const prefs = loadPrefs();
  const acc = accent || prefs.accent || '#5e6ad2';
  const th = theme || prefs.theme || 'dark';
  const color1 = acc;
  const color2 = lighten(acc, 0.42);
  const color3 = th === 'light' ? '#eceaf4' : '#07060c';

  // ShaderGradient only honours individual color props in its interactive
  // ("props") control mode; in static use it falls back to a built-in urlString
  // (a fixed purple/magenta default). So we drive it via control='query' with a
  // urlString built from the accent — the same reliable path customBackgroundUrl
  // uses — so the gradient actually tracks the theme + accent.
  const animate = blinko.config.value?.isCloseBackgroundAnimation ? 'off' : 'on';
  const enc = (c: string) => encodeURIComponent(c);
  const accentUrl =
    `https://www.shadergradient.co/customize?animate=${animate}&axesHelper=off` +
    `&bgColor1=%23000000&bgColor2=%23000000&brightness=1.1&cAzimuthAngle=180` +
    `&cDistance=3.9&cPolarAngle=115&cameraZoom=1` +
    `&color1=${enc(color1)}&color2=${enc(color2)}&color3=${enc(color3)}` +
    `&destination=onCanvas&embedMode=off&envPreset=city&format=gif&fov=45` +
    `&frameRate=10&grain=off&lightType=3d&pixelDensity=1` +
    `&positionX=-0.5&positionY=0.1&positionZ=0&range=enabled&rangeEnd=40&rangeStart=0` +
    `&reflection=0.1&rotationX=0&rotationY=0&rotationZ=235&shader=defaults` +
    `&type=waterPlane&uAmplitude=0&uDensity=1.1&uFrequency=5.5&uSpeed=0.1` +
    `&uStrength=2.4&uTime=0.2&wireframe=false`;

  return (
    <div className={cn("relative w-full h-[100vh]", className)}>
      <GradientErrorBoundary>
        <ShaderGradientCanvas
          style={{
            position: 'absolute',
            top: 0,
          }}
        >
          <ShaderGradient
            control='query'
            urlString={blinko.config.value?.customBackgroundUrl || accentUrl}
          />
        </ShaderGradientCanvas>
      </GradientErrorBoundary>
      {/* Readability scrim: mutes bright accents (e.g. amber) so foreground cards
          and text stay legible, while keeping the gradient visible underneath. */}
      <div
        className="absolute inset-0"
        style={{
          pointerEvents: 'none',
          background: th === 'light'
            ? 'linear-gradient(rgba(255,255,255,0.30), rgba(255,255,255,0.42))'
            : 'radial-gradient(120% 90% at 50% 40%, rgba(7,6,12,0.30), rgba(7,6,12,0.55))',
        }}
      />
      <div className="relative z-10 w-full h-full">
        {children}
      </div>
    </div>
  );
}; 
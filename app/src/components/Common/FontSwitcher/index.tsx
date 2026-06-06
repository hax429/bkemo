import { useState, useEffect } from 'react';
import { api } from '@/lib/trpc';
import { FontManager, FontMetadata } from '@/lib/fontManager';
import { BkemoSelect } from '../BkemoSelect';

interface FontSwitcherProps {
  fontname?: string;
  onChange?: (fontname: string) => void;
}

const FontSwitcher = ({ fontname = 'default', onChange }: FontSwitcherProps) => {
  const [fonts, setFonts] = useState<FontMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch font metadata from database on mount (no binary data - fast!)
  useEffect(() => {
    const fetchFonts = async () => {
      try {
        if (!api.fonts) {
          throw new Error('Font API not available');
        }
        const fontList = await api.fonts.list.query();
        setFonts(fontList);
        FontManager.initializeRegistry(fontList);
      } catch (error) {
        console.error('Failed to fetch fonts:', error);
        setFonts([
          { id: 0, name: 'default', displayName: 'Default (System)', url: null, isLocal: false, weights: [400], category: 'sans-serif', isSystem: true, sortOrder: 0 }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchFonts();
  }, []);

  // Load the current font on mount if not default
  useEffect(() => {
    if (fontname && fontname !== 'default' && fonts.length > 0) {
      FontManager.applyFont(fontname).catch((error) => {
        console.warn('Failed to apply font on mount:', error);
      });
    }
  }, [fontname, fonts]);

  const handleFontSelect = async (selectedFont: string) => {
    if (selectedFont === fontname) return;
    try {
      await FontManager.applyFont(selectedFont);
      onChange?.(selectedFont);
    } catch (error) {
      console.error('Failed to apply font:', error);
    }
  };

  if (loading) {
    return (
      <div style={{
        background: 'var(--bg-2)',
        color: 'var(--fg)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--radius)',
        padding: '6px 12px',
        fontSize: 12,
        fontFamily: 'inherit',
        minWidth: 140
      }}>
        Loading...
      </div>
    );
  }

  const selectOptions = fonts.map(font => ({
    v: font.name,
    label: font.displayName,
    style: {
      fontFamily: font.isSystem ? undefined : `"${font.name}"`
    }
  }));

  return (
    <BkemoSelect
      value={fontname}
      options={selectOptions}
      onChange={handleFontSelect}
    />
  );
};

export default FontSwitcher;
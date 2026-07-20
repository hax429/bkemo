import { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/Common/Iconify/icons';

export interface BkemoSelectOption {
  v: string;
  label: string;
  style?: React.CSSProperties;
}

interface BkemoSelectProps {
  value: string;
  options: BkemoSelectOption[];
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  placement?: 'top' | 'bottom';
}

export function BkemoSelect({ value, options, onChange, style, placement = 'bottom' }: BkemoSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeOption = options.find((o) => o.v === value) ?? options[0];

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'var(--bg-2)',
          color: 'var(--fg)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius)',
          padding: '6px 12px',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: 'pointer',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 140,
          justifyContent: 'space-between',
          transition: 'border-color 0.15s, box-shadow 0.15s'
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-soft)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-2)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <span style={activeOption?.style}>{activeOption?.label || value}</span>
        <Icon 
          icon="tabler:chevron-down" 
          width={14} 
          height={14} 
          style={{ 
            color: 'var(--fg-3)', 
            transform: open ? 'rotate(180deg)' : 'none', 
            transition: 'transform 0.2s',
            flexShrink: 0
          }} 
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: placement === 'bottom' ? 'calc(100% + 4px)' : undefined,
            bottom: placement === 'top' ? 'calc(100% + 4px)' : undefined,
            right: 0,
            background: 'var(--bg-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--radius)',
            padding: 4,
            zIndex: 100,
            minWidth: 180,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
          className="bk-scroll"
        >
          {options.map((o) => {
            const isSelected = o.v === value;
            return (
              <div
                key={o.v}
                onClick={() => {
                  onChange(o.v);
                  setOpen(false);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  color: isSelected ? '#ffffff' : 'var(--fg-2)',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontWeight: isSelected ? 500 : 'normal',
                  ...o.style
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--bg-3)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span>{o.label}</span>
                {isSelected && <Icon icon="tabler:check" width={12} height={12} style={{ color: '#ffffff' }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

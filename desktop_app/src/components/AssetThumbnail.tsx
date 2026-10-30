import React from 'react';

interface AssetThumbnailProps {
  category: string;
  name: string;
  format?: string;
  size?: 'sm' | 'md' | 'lg' | 'fill';
  imageUrl?: string;
}

export const AssetThumbnail: React.FC<AssetThumbnailProps> = ({
  category,
  name,
  format = 'GLB',
  size = 'md',
  imageUrl,
}) => {
  const isFill = size === 'fill';
  const dim = size === 'sm' ? 48 : size === 'lg' ? 130 : 84;
  const boxWidth = isFill ? '100%' : `${dim}px`;
  const boxHeight = isFill ? '100%' : `${dim}px`;
  const cat = (category || 'general').toLowerCase();

  if (imageUrl) {
    return (
      <div
        style={{
          width: boxWidth,
          height: boxHeight,
          borderRadius: '6px',
          overflow: 'hidden',
          backgroundColor: '#12151c',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={imageUrl}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {format && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              color: '#94a3b8',
              fontSize: '8px',
              fontWeight: '700',
              padding: '1px 4px',
              borderRadius: '3px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {format}
          </span>
        )}
      </div>
    );
  }

  // Render stylized 3D Isometric SVG
  return (
    <div
      style={{
        width: boxWidth,
        height: boxHeight,
        borderRadius: '6px',
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#131722',
        backgroundImage: 'radial-gradient(circle at 50% 30%, #1e2433 0%, #0d1017 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <radialGradient id="groundGlow" cx="50%" cy="75%" r="45%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sofaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#92400e" />
          </linearGradient>
          <linearGradient id="lampGlow" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          <linearGradient id="plantGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>

        {/* Ambient Ground Grid */}
        <ellipse cx="50" cy="74" rx="36" ry="14" fill="url(#groundGlow)" />
        <path
          d="M 22 74 L 50 86 L 78 74 L 50 62 Z"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="0.8"
        />

        {/* Category-Specific 3D Isometric Vector Models */}
        {cat.includes('seating') || cat.includes('sofa') || cat.includes('chair') ? (
          /* 3D Isometric Sofa */
          <g transform="translate(0, -2)">
            {/* Base / Cushion */}
            <path d="M 26 58 L 50 70 L 74 58 L 50 46 Z" fill="url(#sofaGrad)" opacity="0.9" />
            <path d="M 26 58 L 26 65 L 50 77 L 50 70 Z" fill="#1d4ed8" />
            <path d="M 50 70 L 50 77 L 74 65 L 74 58 Z" fill="#1e40af" />
            {/* Backrest */}
            <path d="M 28 42 L 50 53 L 44 56 L 22 45 Z" fill="#3b82f6" />
            <path d="M 50 53 L 72 42 L 78 45 L 56 56 Z" fill="#2563eb" />
            {/* Armrests */}
            <path d="M 22 47 L 28 50 L 28 62 L 22 59 Z" fill="#60a5fa" />
            <path d="M 72 50 L 78 47 L 78 59 L 72 62 Z" fill="#1d4ed8" />
          </g>
        ) : cat.includes('table') ? (
          /* 3D Isometric Table */
          <g transform="translate(0, 0)">
            {/* Table Top */}
            <path d="M 24 50 L 50 62 L 76 50 L 50 38 Z" fill="url(#woodGrad)" />
            <path d="M 24 50 L 24 54 L 50 66 L 50 62 Z" fill="#78350f" />
            <path d="M 50 62 L 50 66 L 76 54 L 76 50 Z" fill="#451a03" />
            {/* 4 Legs */}
            <line x1="26" y1="53" x2="26" y2="76" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="74" y1="53" x2="74" y2="76" stroke="#451a03" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="49" y1="65" x2="49" y2="82" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="50" y1="41" x2="50" y2="60" stroke="#291204" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
          </g>
        ) : cat.includes('bed') ? (
          /* 3D Isometric Bed */
          <g transform="translate(0, 0)">
            {/* Headboard */}
            <path d="M 28 40 L 50 51 L 50 34 L 28 23 Z" fill="#475569" />
            {/* Mattress */}
            <path d="M 30 45 L 50 55 L 72 44 L 52 34 Z" fill="#f8fafc" />
            <path d="M 50 55 L 50 64 L 72 53 L 72 44 Z" fill="#cbd5e1" />
            <path d="M 30 45 L 30 54 L 50 64 L 50 55 Z" fill="#94a3b8" />
            {/* Pillows */}
            <polygon points="36,43 44,47 48,44 40,40" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.5" />
            <polygon points="44,39 52,43 56,40 48,36" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.5" />
          </g>
        ) : cat.includes('lighting') || cat.includes('lamp') ? (
          /* 3D Isometric Standing Lamp */
          <g transform="translate(0, -4)">
            {/* Lamp Beam Cone */}
            <polygon points="50,38 30,76 70,76" fill="url(#lampGlow)" opacity="0.4" />
            {/* Base */}
            <ellipse cx="50" cy="76" rx="12" ry="5" fill="#334155" />
            {/* Pole */}
            <line x1="50" y1="36" x2="50" y2="76" stroke="#94a3b8" strokeWidth="2" />
            {/* Shade */}
            <polygon points="42,36 58,36 64,46 36,46" fill="#f59e0b" />
            <ellipse cx="50" cy="36" rx="8" ry="2.5" fill="#fde68a" />
          </g>
        ) : cat.includes('electronics') || cat.includes('tv') ? (
          /* 3D Isometric Television */
          <g transform="translate(0, -2)">
            {/* Stand */}
            <ellipse cx="50" cy="74" rx="10" ry="4" fill="#334155" />
            <rect x="48.5" y="65" width="3" height="9" fill="#64748b" />
            {/* Screen frame */}
            <path d="M 26 42 L 74 34 L 74 62 L 26 70 Z" fill="#0f172a" stroke="#475569" strokeWidth="1" />
            {/* Screen glass glow */}
            <path d="M 28 44 L 72 36 L 72 60 L 28 68 Z" fill="#0284c7" opacity="0.75" />
            <line x1="32" y1="46" x2="68" y2="58" stroke="#38bdf8" strokeWidth="1" opacity="0.4" />
          </g>
        ) : cat.includes('storage') || cat.includes('wardrobe') ? (
          /* 3D Isometric Cabinet / Wardrobe */
          <g transform="translate(0, -6)">
            {/* Top */}
            <path d="M 32 36 L 50 44 L 68 36 L 50 28 Z" fill="#64748b" />
            {/* Left face */}
            <path d="M 32 36 L 32 74 L 50 82 L 50 44 Z" fill="#475569" />
            {/* Right face */}
            <path d="M 50 44 L 50 82 L 68 74 L 68 36 Z" fill="#334155" />
            {/* Door seam & handles */}
            <line x1="50" y1="44" x2="50" y2="82" stroke="#1e293b" strokeWidth="1" />
            <circle cx="47" cy="62" r="1.5" fill="#f59e0b" />
            <circle cx="53" cy="62" r="1.5" fill="#f59e0b" />
          </g>
        ) : cat.includes('decor') || cat.includes('plant') ? (
          /* 3D Isometric Potted Plant */
          <g transform="translate(0, 0)">
            {/* Pot */}
            <polygon points="40,58 60,58 56,76 44,76" fill="#ea580c" />
            <ellipse cx="50" cy="58" rx="10" ry="3.5" fill="#c2410c" />
            {/* Leaves */}
            <path d="M 50 56 Q 38 42 32 46 Q 42 52 50 56" fill="url(#plantGrad)" />
            <path d="M 50 56 Q 52 36 50 30 Q 58 40 50 56" fill="url(#plantGrad)" />
            <path d="M 50 56 Q 62 42 68 46 Q 58 52 50 56" fill="url(#plantGrad)" />
          </g>
        ) : cat.includes('rug') ? (
          /* 3D Isometric Rug */
          <g transform="translate(0, 2)">
            <path d="M 20 68 L 50 82 L 80 68 L 50 54 Z" fill="#818cf8" stroke="#a5b4fc" strokeWidth="1.2" />
            <path d="M 28 68 L 50 78 L 72 68 L 50 58 Z" fill="#6366f1" opacity="0.6" />
          </g>
        ) : (
          /* Universal 3D Isometric Prism / Mesh */
          <g transform="translate(0, -2)">
            {/* Top face */}
            <polygon points="50,30 74,42 50,54 26,42" fill="url(#metalGrad)" />
            {/* Left face */}
            <polygon points="26,42 50,54 50,76 26,64" fill="#334155" />
            {/* Right face */}
            <polygon points="50,54 74,42 74,64 50,76" fill="#1e293b" />
            {/* Wireframe accent line */}
            <line x1="50" y1="54" x2="50" y2="76" stroke="#818cf8" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Format Badge Top Right */}
      {format && (
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#94a3b8',
            fontSize: '8px',
            fontWeight: '700',
            padding: '1px 4px',
            borderRadius: '3px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            letterSpacing: '0.04em',
          }}
        >
          {format}
        </span>
      )}
    </div>
  );
};

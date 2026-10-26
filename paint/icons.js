// Tool and history icons. Lucide-style 24x24 stroke icons, copied from the set PhotoCraft
// vendors under assets/icons. Lucide is ISC licensed: Copyright (c) 2026 Lucide Icons and Contributors.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or
// without fee is hereby granted, provided that the above copyright notice and this permission
// notice appear in all copies. The software is provided "as is" without warranty.
//
// Each entry is the inner markup of a <svg viewBox="0 0 24 24">. Nothing is fetched at runtime.
// 'fx' has no asset: PhotoCraft paints the Layers footer's fx as italic text (panels.rs fx_button).

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICONS = {
  'adjustment-layer':
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  'align-center': '<path d="M21 5H3"/><path d="M17 12H7"/><path d="M19 19H5"/>',
  'align-justify': '<path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/>',
  'align-left': '<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>',
  'align-right': '<path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/>',
  'align-edge-bottom':
    '<path d="M3 20h18"/><rect x="5" y="4" width="5" height="12" rx="1"/><rect x="14" y="9" width="5" height="7" rx="1"/>',
  'align-edge-hcenter':
    '<path d="M12 3v18"/><rect x="5" y="5" width="14" height="5" rx="1"/><rect x="8" y="14" width="8" height="5" rx="1"/>',
  'align-edge-left':
    '<path d="M4 3v18"/><rect x="8" y="5" width="12" height="5" rx="1"/><rect x="8" y="14" width="7" height="5" rx="1"/>',
  'align-edge-right':
    '<path d="M20 3v18"/><rect x="4" y="5" width="12" height="5" rx="1"/><rect x="9" y="14" width="7" height="5" rx="1"/>',
  'align-edge-top':
    '<path d="M3 4h18"/><rect x="5" y="8" width="5" height="12" rx="1"/><rect x="14" y="8" width="5" height="7" rx="1"/>',
  'align-edge-vcenter':
    '<path d="M3 12h18"/><rect x="5" y="5" width="5" height="14" rx="1"/><rect x="14" y="8" width="5" height="8" rx="1"/>',
  'app-window':
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  'arrow-left-right':
    '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  bandage:
    '<path d="M10 10.01h.01"/><path d="M10 14.01h.01"/><path d="M14 10.01h.01"/><path d="M14 14.01h.01"/><path d="M18 6v12"/><path d="M6 6v12"/><rect x="2" y="6" width="20" height="12" rx="2"/>',
  blend: '<circle cx="15" cy="9" r="7"/><circle cx="9" cy="15" r="7"/>',
  brush:
    '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/>',
  'brush-cleaning':
    '<path d="m16 22-1-4"/><path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1"/><path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z"/><path d="m8 22 1-4"/>',
  'brush-replace':
    '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/><path d="M2.5 9A6 6 0 0 1 8 3"/><path d="m6 1.5 2 1.5-2 1.5"/><path d="M21.5 15a6 6 0 0 1-5.5 6"/><path d="m18 19.5-2 1.5 2 1.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevrons-left': '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  'circle-dot': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="10"/>',
  // PhotoCraft's own clipping-mask glyph (assets/icons/clip-below.svg).
  'clip-below':
    '<path d="M5 4h4.5a5.5 5.5 0 0 1 5.5 5.5V16"/><path d="m11.5 12.5 3.5 3.5 3.5-3.5"/><path d="M5 20.5h14"/>',
  contrast:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" stroke="none"/>',
  compass:
    '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  diamond:
    '<path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/>',
  'distribute-bottom':
    '<path d="M4 7h16"/><rect x="7" y="2" width="10" height="3" rx="1"/><path d="M4 14h16"/><rect x="7" y="9" width="10" height="3" rx="1"/><path d="M4 21h16"/><rect x="7" y="16" width="10" height="3" rx="1"/>',
  'distribute-hcenter':
    '<rect x="2" y="6" width="4" height="12" rx="1"/><path d="M4 2v2"/><path d="M4 20v2"/><rect x="10" y="6" width="4" height="12" rx="1"/><path d="M12 2v2"/><path d="M12 20v2"/><rect x="18" y="6" width="4" height="12" rx="1"/><path d="M20 2v2"/><path d="M20 20v2"/>',
  'distribute-horizontal':
    '<path d="M3 4v16"/><path d="M21 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>',
  'distribute-left':
    '<path d="M3 4v16"/><rect x="5" y="7" width="3" height="10" rx="1"/><path d="M10 4v16"/><rect x="12" y="7" width="3" height="10" rx="1"/><path d="M17 4v16"/><rect x="19" y="7" width="3" height="10" rx="1"/>',
  'distribute-right':
    '<path d="M7 4v16"/><rect x="2" y="7" width="3" height="10" rx="1"/><path d="M14 4v16"/><rect x="9" y="7" width="3" height="10" rx="1"/><path d="M21 4v16"/><rect x="16" y="7" width="3" height="10" rx="1"/>',
  'distribute-top':
    '<path d="M4 3h16"/><rect x="7" y="5" width="10" height="3" rx="1"/><path d="M4 10h16"/><rect x="7" y="12" width="10" height="3" rx="1"/><path d="M4 17h16"/><rect x="7" y="19" width="10" height="3" rx="1"/>',
  'distribute-vcenter':
    '<rect x="6" y="2" width="12" height="4" rx="1"/><path d="M2 4h2"/><path d="M20 4h2"/><rect x="6" y="10" width="12" height="4" rx="1"/><path d="M2 12h2"/><path d="M20 12h2"/><rect x="6" y="18" width="12" height="4" rx="1"/><path d="M2 20h2"/><path d="M20 20h2"/>',
  'distribute-vertical':
    '<path d="M4 3h16"/><path d="M4 21h16"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
  droplet:
    '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  'ellipse-dashed': '<ellipse cx="12" cy="12" rx="10" ry="7" stroke-dasharray="3.5 3.23"/>',
  ellipsis:
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  eraser:
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
  'eraser-background':
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/><path d="M2 2h1"/><path d="M6 2h1"/><path d="M2 6h1"/><path d="M4 4h1"/>',
  'eraser-magic':
    '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/><path d="M5 1v5"/><path d="M7.5 3.5h-5"/>',
  flame:
    '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-open':
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  fx: '<text x="12" y="17" text-anchor="middle" font-family="serif" font-size="15" font-style="italic" fill="currentColor" stroke="none">fx</text>',
  gradient:
    '<defs><linearGradient id="paint-icon-gradient" x1="3" y1="0" x2="20" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="currentColor" stop-opacity="0.9"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect width="18" height="16" x="3" y="4" rx="2" fill="url(#paint-icon-gradient)"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  'grid-3x3':
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  lasso:
    '<path d="M3.704 14.467a10 8 0 1 1 3.115 2.375"/><path d="M7 22a5 5 0 0 1-2-3.994"/><circle cx="5" cy="16" r="2"/>',
  'lasso-select':
    '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M7 16.93c.96.43 1.96.74 2.99.91"/><path d="M3.34 14A6.8 6.8 0 0 1 2 10c0-4.42 4.48-8 10-8s10 3.58 10 8a7.19 7.19 0 0 1-.33 2"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M14.33 22h-.09a.35.35 0 0 1-.24-.32v-10a.34.34 0 0 1 .33-.34c.08 0 .15.03.21.08l7.34 6a.33.33 0 0 1-.21.59h-4.49l-2.57 3.85a.35.35 0 0 1-.28.14z"/>',
  // PhotoCraft assets/icons/lasso-magnetic.svg, adapted from "Magnetic Lasso Tool" by Lil' Seal
  // (Noun Project, CC BY 3.0).
  'lasso-magnetic':
    '<path d="M9 1.9H16.4A4.6 4.6 0 0 1 21 6.5V7.7A4.6 4.6 0 0 1 16.4 12.3H9V8.95H16.55A0.6 0.6 0 0 0 17.15 8.35V5.85A0.6 0.6 0 0 0 16.55 5.25H9ZM9.75 2.65H12.5V4.5H9.75ZM9.75 9.7H12.5V11.55H9.75Z" fill="currentColor" fill-rule="evenodd" stroke="none"/><path d="M12.4 7.5 1.8 3.6l7.7 15.3-1.8 2.8" stroke-width="1.5"/><ellipse cx="9.25" cy="16.65" rx="2.85" ry="2.2" stroke-width="1.5"/><path d="m12.1 16.2 10.1-3-1.6-1" stroke-width="1.5"/>',
  hand:
    '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'layer-mask':
    '<rect width="20" height="16" x="2" y="4" rx="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  'link-2':
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'lock-open':
    '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lollipop:
    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 11a2 2 0 0 0 4 0 4 4 0 0 0-8 0 6 6 0 0 0 12 0"/>',
  'marquee-column':
    '<path d="M8 3h8"/><path d="M8 21h8"/><path d="M12 6.5v1"/><path d="M12 11.5v1"/><path d="M12 16.5v1"/>',
  'marquee-row':
    '<path d="M3 8v8"/><path d="M21 8v8"/><path d="M6.5 12h1"/><path d="M11.5 12h1"/><path d="M16.5 12h1"/>',
  'maximize-2':
    '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
  'message-square':
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  minus: '<path d="M5 12h14"/>',
  move: '<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/>',
  'paint-bucket':
    '<path d="M11 7 6 2"/><path d="M18.992 12H2.041"/><path d="M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595"/><path d="m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33"/>',
  palette:
    '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'convert-point':
    '<rect x="9.75" y="4.75" width="4.5" height="4.5"/><path d="M10.5 9.25 4 19"/><path d="M13.5 9.25 20 19"/>',
  'direct-select':
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/><rect x="16.5" y="16.5" width="4.5" height="4.5"/>',
  'mouse-pointer-2':
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  'pen-add-anchor':
    '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/><path d="M18 3.5h5"/><path d="M20.5 1v5"/>',
  'pen-curvature':
    '<g transform="translate(7 7) scale(0.68)" stroke-width="2.6"><path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/></g><path d="M3 12C3 7 7 3 12 3"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="3" r="1" fill="currentColor"/>',
  'pen-delete-anchor':
    '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/><path d="M18 3.5h5"/>',
  'pen-freeform':
    '<g transform="translate(7 7) scale(0.68)" stroke-width="2.6"><path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/></g><path d="M8.5 8.5C6 6 7.5 3 5 3S2 6 4 7.5 5.5 11 3 12"/>',
  'pen-tool':
    '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
  pentagon:
    '<path d="M10.83 2.38a2 2 0 0 1 2.34 0l8 5.74a2 2 0 0 1 .73 2.25l-3.04 9.26a2 2 0 0 1-1.9 1.37H7.04a2 2 0 0 1-1.9-1.37L2.1 10.37a2 2 0 0 1 .73-2.25z"/>',
  'perspective-crop':
    '<path d="M8 6h8l4 12H4z"/><path d="M12 6v12"/><path d="M6 12h12"/><path d="M8 2v2"/><path d="M20 22v-2"/>',
  pipette:
    '<path d="m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12"/><path d="m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z"/><path d="m2 22 .414-.414"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pointer:
    '<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  'quick-selection':
    '<path d="M14 3H7a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h7" stroke-dasharray="2 3"/><path d="m14 10 2.1 2.1"/><path d="M10.85 17.7A2.45 2.45 0 1 0 8.4 15.25a1.834 1.834 0 0 1-.496 1.254A.7 .7 0 0 0 8.4 17.7z"/><path d="M13.278 14.922 21.265 6.937a.7 .7 0 0 0-2.101-2.101L11.177 12.822"/>',
  ruler:
    '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  'rotate-cw':
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  'rectangle-horizontal': '<rect width="20" height="12" x="2" y="6" rx="2"/>',
  sampler:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  scaling:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 15H9v-5"/><path d="M16 3h5v5"/><path d="M21 3 9 15"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  slash: '<path d="M22 2 2 22"/>',
  sparkles:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  'sliders-horizontal':
    '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  'square-dashed':
    '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  spline:
    '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  'square-plus':
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  'squares-subtract':
    '<path d="M10 22a2 2 0 0 1-2-2"/><path d="M16 22h-2"/><path d="M16 4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-5a2 2 0 0 1 2-2h5a1 1 0 0 0 1-1z"/><path d="M20 8a2 2 0 0 1 2 2"/><path d="M22 14v2"/><path d="M22 20a2 2 0 0 1-2 2"/>',
  stamp:
    '<path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/><path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/><path d="M5 22h14"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'swatch-book':
    '<path d="M11 17a4 4 0 0 1-8 0V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2Z"/><path d="M16.7 13H19a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7"/><path d="M 7 17h.01"/><path d="m11 8 2.3-2.3a2.4 2.4 0 0 1 3.404.004L18.6 7.6a2.4 2.4 0 0 1 .026 3.434L9.9 19.8"/>',
  trash:
    '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>',
  'type-mask':
    '<path d="M4 7V4h16v3" stroke-dasharray="2.5 2.5"/><path d="M12 4v16" stroke-dasharray="2.5 2.5"/><path d="M8.5 20h7" stroke-dasharray="2.5 2.5"/>',
  'type-mask-vertical':
    '<path d="M2.5 7V4h12v3" stroke-dasharray="2.5 2.5"/><path d="M8.5 4v16" stroke-dasharray="2.5 2.5"/><path d="M6 20h5" stroke-dasharray="2.5 2.5"/><path d="M20 8v12"/><path d="M17.5 17.5 20 20l2.5-2.5"/>',
  type: '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  'wand-sparkles':
    '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'zoom-in':
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>'
};

/**
 * Build the <svg> for icon `name`: 24 viewBox, no fill, currentColor stroke, round caps and
 * joins (Lucide's defaults). Throws on an unknown name so a typo shows up in tests.
 * PhotoCraft's Layers "fx" is italic text (panels.rs fx_button), not a Lucide path — that
 * glyph is built with createElementNS so it stays in the SVG namespace.
 */
export function iconSvg(name, size = 20, doc = globalThis.document) {
  const markup = ICONS[name];
  if (markup == null) throw new Error(`Unknown icon: ${name}`);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attrs = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false'
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  if (name === 'fx') {
    const text = doc.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', '12');
    text.setAttribute('y', '17');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'Georgia, "Times New Roman", serif');
    text.setAttribute('font-size', '15');
    text.setAttribute('font-style', 'italic');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', 'currentColor');
    text.setAttribute('stroke', 'none');
    text.textContent = 'fx';
    svg.appendChild(text);
    return svg;
  }
  svg.innerHTML = markup;
  return svg;
}

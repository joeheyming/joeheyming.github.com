#!/usr/bin/env python3
"""Build scripts/ralph/parity.json from PhotoCraft's menu catalog and toolbox.

Run once to seed the checklist; afterwards the Ralph loop edits parity.json by hand
(flip `impl` / `done` as stories land). Re-running overwrites statuses, so pass
--keep to carry existing statuses over by id.

  python3 scripts/ralph/build-parity.py [--keep]
"""
import json
import re
import sys
from pathlib import Path

PHOTOCRAFT = Path('/Users/jheyming/git/photocraft')
OUT = Path(__file__).with_name('parity.json')

# Whole menu paths that a static canvas page cannot do (colour management, print, video,
# multi-document windows, ML, scripting) or that PhotoCraft itself treats as host features.
OUT_PATHS = {
    'File > Generate', 'File > Automate', 'File > Import', 'Edit > Purge', 'Edit > Presets',
    'Edit > Preferences', 'Image > Variables', 'Layer > Video Layers', 'Layer > Smart Filter',
    'Layer > Smart Objects > Stack Mode', 'Type > OpenType', 'Type > Language Options',
    'Type > Font Preview Size', 'View > Proof Setup', 'View > Pixel Aspect Ratio',
    'Window > Arrange', 'Window > Workspace',
}
OUT_ITEMS = {
    'File': {'Open As…', 'Open EXR Parts…', 'Close All', 'Close Others', 'Place Linked…',
             'Package…', 'Print…', 'Print One Copy', 'Exit'},
    'File > Export': {'Export Preferences…', 'Save for Web (Legacy)…', 'Artboards to Files…',
                      'Artboards to PDF…', 'Layer Comps to Files…', 'Color Lookup Tables…',
                      'Data Sets as Files…', 'Paths to Illustrator…', 'Render Video…'},
    'File > Scripts': {'Image Processor…', 'Script Events Manager…', 'Load Files into Stack…',
                       'Statistics…', 'Browse…', 'Flatten All Layer Effects'},
    'Edit': {'Search…', 'Check Spelling…', 'Find and Replace Text…', 'Content-Aware Fill…',
             'Content-Aware Scale', 'Puppet Warp', 'Perspective Warp', 'Auto-Align Layers…',
             'Auto-Blend Layers…', 'Color Settings…', 'Assign Profile…', 'Convert to Profile…',
             'Menus…', 'Toolbar…', 'Define Brush Preset…'},
    'Edit > Transform': {'Split Warp Horizontally', 'Split Warp Vertically',
                         'Split Warp Crosswise', 'Remove Warp Split'},
    'Image > Mode': {'Duotone', 'CMYK Color', 'Lab Color', 'Multichannel', '16 Bits/Channel',
                     '32 Bits/Channel'},
    'Image > Adjustments': {'HDR Toning…', 'Match Color…'},
    # Paint is one document with canvas-sized layers: no second window, no off-canvas pixels.
    'Image': {'Apply Data Set…', 'Trap…', 'Apply Image…', 'Calculations…', 'Duplicate…',
              'Reveal All'},
    'Image > Analysis': {'Select Data Points…', 'Record Measurements', 'Place Scale Marker…'},
    'Layer > New': {'Artboard…', 'Artboard from Group…', 'Artboard from Layers…',
                    'Frame from Layers'},
    'Layer': {'Quick Export as PNG', 'Export As…', 'Layer Content Options…', 'Mask All Objects',
              'New Layer Based Slice', 'Link Layers', 'Select Linked Layers'},
    'Layer > Layer Style': {'Global Light…', 'Create Layer', 'Scale Effects…'},
    'Layer > Vector Mask': {'Link Vector Mask'},
    'Layer > Layer Mask': {'Link Layer Mask'},
    'Layer > Smart Objects': {'Reveal in Finder', 'Update Modified Content',
                              'Update All Modified Content', 'Relink to File…',
                              'Convert to Linked…', 'Convert to Embedded', 'Export Contents…',
                              'Replace Contents…', 'Edit Contents', 'Warp', 'Perspective Warp',
                              'Puppet Warp'},
    'Layer > Rasterize': {'Video', 'Smart Object', 'Fill Content', 'Layer Style'},
    'Layer > Matting': {'Color Decontaminate…'},
    'Type': {'Update All Text Layers', 'Replace All Missing Fonts', 'Resolve Missing Fonts…',
             'Load Default Type Styles', 'Save Default Type Styles', 'Create Work Path',
             'Convert to Shape'},
    'Type > Anti-Alias': {'Windows LCD', 'Windows'},
    'Type > Panels': {'Glyphs Panel', 'Character Styles Panel', 'Paragraph Styles Panel'},
    'Select': {'Focus Area…', 'Subject', 'Sky', 'Select and Mask…', 'Convert to Shape',
               'Find Layers', 'Isolate Layers'},
    'Filter': {'Convert for Smart Filters', 'Filter Gallery…', 'Camera Raw Filter…',
               'Adaptive Wide Angle…', 'Lens Correction…', 'Vanishing Point…'},
    'Filter > Blur Gallery': {'Path Blur…'},
    'Filter > Render': {'Flame…', 'Picture Frame…', 'Tree…'},
    'Filter > Noise': {'Reduce Noise…'},
    'View': {'Proof Colors', 'Gamut Warning', 'Pixel Aspect Ratio Correction',
             '32-bit Preview Options…', 'Fit Artboard on Screen', 'Print Size',
             'Clear Selected Artboard Guides', 'Clear Canvas Guides', 'New Guides From Shape',
             'Lock Slices', 'Clear Slices', 'Pattern Preview'},
    'View > Show': {'Canvas Guides', 'Artboard Guides', 'Slices', 'Notes', 'Mesh', 'Edit Pins',
                    'Show Extras Options…', 'Target Path', 'Count'},
    'View > Snap To': {'Slices'},
    'Window': {'Actions', 'Character Styles', 'Glyphs', 'Layer Comps', 'Measurement Log',
               'Modifier Keys', 'Notes', 'Paragraph Styles', 'Timeline'},
}

# Present in Paint today at the same menu path (done) or present somewhere else (impl only).
DONE = {
    'File': {'New…', 'Open…'},
    'File > Export': {'Quick Export as PNG', 'Export As…'},
    'Edit': {'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Clear', 'Define Pattern…',
             'Free Transform'},
    'Edit > Transform': {'Scale', 'Rotate'},
    'Image': {'Auto Tone', 'Auto Contrast', 'Auto Color', 'Canvas Size…', 'Crop'},
    'Image > Image Rotation': {'180°', '90° Clockwise', '90° Counter Clockwise', 'Arbitrary…',
                               'Flip Canvas Horizontal', 'Flip Canvas Vertical'},
    'Image > Analysis': {'Ruler Tool'},
    'Layer > New': {'Layer…'},
    'Layer': {'Duplicate Layer…', 'Rename Layer', 'Hide Layers', 'Merge Layers',
              'Flatten Image'},
    'Layer > Delete': {'Layer'},
    'Layer > New Adjustment Layer': {'Brightness/Contrast…', 'Levels…', 'Curves…', 'Exposure…',
                                     'Vibrance…', 'Hue/Saturation…', 'Color Balance…',
                                     'Black & White…', 'Photo Filter…', 'Channel Mixer…',
                                     'Color Lookup…', 'Invert…', 'Posterize…', 'Threshold…',
                                     'Gradient Map…', 'Selective Color…'},
    'Layer > Layer Mask': {'Reveal All', 'Hide All', 'Reveal Selection', 'Delete', 'Apply',
                           'Enable Layer Mask'},
    'Select': {'All', 'Deselect', 'Inverse Selection'},
    'Select > Modify': {'Expand…', 'Contract…', 'Feather…'},
    'View': {'Zoom In', 'Zoom Out', '100%'},
    'Window': {'Color', 'Swatches', 'Layers', 'History', 'Options', 'Tools'},
}
# Algorithm exists in paint/adjustments.js but sits in the Image menu, not Filter / Adjustments.
IMPL = {
    'Image > Adjustments': {'Brightness/Contrast…', 'Levels…', 'Curves…', 'Exposure…',
                            'Vibrance…', 'Hue/Saturation…', 'Color Balance…', 'Black & White…',
                            'Photo Filter…', 'Channel Mixer…', 'Color Lookup…', 'Invert',
                            'Posterize…', 'Threshold…', 'Gradient Map…', 'Selective Color…',
                            'Desaturate'},
    'Filter > Blur': {'Average', 'Blur', 'Blur More', 'Box Blur…', 'Gaussian Blur…',
                      'Motion Blur…', 'Radial Blur…', 'Shape Blur…', 'Smart Blur…',
                      'Surface Blur…'},
    'Filter > Distort': {'Pinch…', 'Polar Coordinates…', 'Ripple…', 'Spherize…', 'Twirl…',
                         'Wave…', 'ZigZag…'},
    'Filter > Noise': {'Add Noise…', 'Despeckle', 'Dust & Scratches…', 'Median…'},
    'Filter > Pixelate': {'Color Halftone…', 'Crystallize…', 'Facet', 'Fragment', 'Mezzotint…',
                          'Mosaic…', 'Pointillize…'},
    'Filter > Render': {'Clouds', 'Difference Clouds', 'Fibers…', 'Lens Flare…',
                        'Lighting Effects…'},
    'Filter > Sharpen': {'Sharpen', 'Sharpen Edges', 'Sharpen More', 'Smart Sharpen…',
                         'Unsharp Mask…'},
    'Filter > Stylize': {'Diffuse…', 'Emboss…', 'Find Edges', 'Solarize', 'Trace Contour…',
                         'Wind…'},
    'Filter > Video': {'De-Interlace…', 'NTSC Colors'},
    'Filter > Other…': {'High Pass…', 'Maximum…', 'Minimum…', 'Offset…'},
}

TOOLS_OUT = {'Artboard', 'Remove', 'ContentAwareMove', 'ObjectSelection', 'Slice',
             'SliceSelect', 'Frame'}
TOOLS_DONE = {
    'Move', 'RectMarquee', 'EllipseMarquee', 'SingleRowMarquee', 'SingleColumnMarquee', 'Lasso',
    'PolygonLasso', 'MagicWand', 'Crop', 'PerspectiveCrop', 'Eyedropper', 'Ruler', 'Brush',
    'Pencil', 'MixerBrush', 'ColorReplacement', 'Eraser', 'BackgroundEraser', 'MagicEraser',
    'Gradient', 'PaintBucket', 'Type', 'SpotHealing', 'Healing', 'Patch', 'RedEye',
    'CloneStamp', 'PatternStamp', 'HistoryBrush', 'Blur', 'Sharpen', 'Smudge', 'Dodge', 'Burn',
    'Sponge', 'Rectangle', 'EllipseShape', 'Line',
}

# Window-menu panels double as the panel checklist, so they are scored once under Window.

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def main():
    keep = '--keep' in sys.argv
    old = {}
    if keep and OUT.exists():
        old = {e['id']: e for e in json.loads(OUT.read_text())['items']}

    src = (PHOTOCRAFT / 'crates/ui-egui/src/menu_catalog.rs').read_text()
    rows = re.findall(
        r'\(&\[([^\]]*)\], "([^"]*)", (?:Some\("[^"]*"\)|None), "([^"]*)"\)', src)
    items = []
    for path, label, cid in rows:
        if label == '---':
            continue
        p = ' > '.join(x.strip().strip('"') for x in path.split(','))
        scope = 'out' if p in OUT_PATHS or label in OUT_ITEMS.get(p, ()) else 'in'
        done = label in DONE.get(p, ())
        impl = done or label in IMPL.get(p, ())
        items.append({'id': 'menu:' + cid, 'area': 'menu', 'path': p, 'label': label,
                      'scope': scope, 'impl': impl, 'done': done})

    state = (PHOTOCRAFT / 'crates/ui-egui/src/state.rs').read_text()
    body = state.split('pub enum Tool {', 1)[1].split('\n}', 1)[0]
    for name in re.findall(r'^\s+([A-Z][A-Za-z]+),', body, re.M):
        done = name in TOOLS_DONE
        items.append({'id': 'tool:' + slug(name), 'area': 'tool', 'path': 'Tools',
                      'label': name, 'scope': 'out' if name in TOOLS_OUT else 'in',
                      'impl': done, 'done': done})

    for e in items:
        if e['id'] in old:
            for k in ('scope', 'impl', 'done', 'note'):
                if k in old[e['id']]:
                    e[k] = old[e['id']][k]

    OUT.write_text(json.dumps({
        'source': 'PhotoCraft crates/ui-egui/src/menu_catalog.rs + state.rs Tool enum',
        'rules': {
            'done': 'The command works in Paint (a test runs it and asserts pixels, a mask, '
                    'the layer stack, or the view) and it is reached where PhotoCraft puts it. '
                    'A label or an empty panel is not done.',
            'impl': 'Behavior exists in Paint but is reached somewhere else.',
            'scope': 'out = not possible or not wanted in a static canvas page.',
        },
        'items': items,
    }, indent=1, ensure_ascii=False) + '\n')
    print(f'wrote {OUT} ({len(items)} items)')


if __name__ == '__main__':
    main()

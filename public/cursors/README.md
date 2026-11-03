# White-glove cursors

Four original vector cursor drawings inspired by the supplied cartoon glove reference. White fill, near-black outline, transparent background. No fonts, embedded bitmaps, scripts or external dependencies.

| SVG | Pose | Hotspot at 48 × 48 |
| --- | --- | --- |
| `glove-point.svg` | Upright pointing finger | `21 3` |
| `glove-point-tilted.svg` | Pointing toward the upper left | `14 7` |
| `glove-open.svg` | Open hand / ready to grab | `24 24` |
| `glove-grab.svg` | Grabbing | `24 25` |

Each SVG has a 128 × 128 viewBox and a native 48 × 48 cursor size. Scale it freely for video overlays; scale hotspot coordinates with the displayed size. For browser use, keep the native size and import `cursors.css`, or use:

```css
.clickable {
  cursor: url('/cursors/glove-point.svg') 21 3, pointer;
}
.draggable {
  cursor: url('/cursors/glove-open.svg') 24 24, grab;
}
.draggable:active {
  cursor: url('/cursors/glove-grab.svg') 24 25, grabbing;
}
```

The optional class names in `cursors.css` begin with `cursor-glove-`. The local comparison page is `output/cursors/preview.html`; `output/cursors/preview.png` is the contact sheet. Assets are local candidates, not wired into recording, playback or the application UI.

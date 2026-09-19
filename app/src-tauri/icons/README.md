# Application icons

`icon-source.png` is the 1024 × 1024 transparent master for the macOS and
Windows icons. It was cropped from the supplied
`a2ab368e-2d37-4f4b-8f89-f742d21ef2cc.png`. The white rounded tile and purple
artwork are retained; the outside background is transparent.

`icon.icns`, `icon.ico`, and the other PNG sizes are exported with the project's
Tauri CLI. Both platform configurations already reference these assets.

To regenerate, run from `app/`:

```sh
npm run tauri -- icon src-tauri/icons/icon-source.png --output /tmp/markpdf-icons
```

Copy the top-level PNG, ICO, and ICNS files from the output directory here.
Keep `icon-source.png` as the master; the generated `icon.png` is a smaller
export. The older `icon-macos.svg` is not used by either bundle configuration.

## Source preparation

Background extraction was evaluated with the built-in imagegen tool using this
prompt:

> Use case: background-extraction. Asset type: macOS and Windows application icon master. Input image 1 is the edit target, not a style reference. The user requests cropping this exact image to use as their application icon. Perform only a faithful crop and background cutout: retain the entire large white/lavender rounded-square tile and all of its purple folded-document/M artwork exactly as in the source, including the original lighting, gradients, proportions, details, and colors. Remove the surrounding white photographic canvas outside the rounded-square tile and make that outside area truly transparent alpha. Preserve clean antialiased rounded edges and at most a very subtle natural contact shadow. Frame the complete rounded square centrally on a square transparent 1024x1024 canvas with approximately 5% transparent safety margin on each side. Do not redraw, reinterpret, simplify, add any text, change the symbol, or crop into the rounded-square tile. Deliver a single transparent PNG icon.

For the final export, a smooth SVG clipping path was applied to the original
image pixels to preserve the artwork and avoid extraction artifacts. The tile
is centered with approximately 7% transparent padding. The saved master includes
that crop and is sufficient for all future exports.

---
name: Texelpad
description: A compact, low-fi material painting workbench.
colors:
  shell: "#dcd8e5"
  panel: "#e6e2ec"
  ink: "#302d3d"
  muted: "#645e71"
  line: "#b9b2c8"
  accent: "#efc28e"
  selected: "#e9decd"
  selected-line: "#b7aa99"
  focus: "#795298"
  control: "#f3eff7"
  topbar: "#cbc5da"
  studio: "#eeedf1"
  primary-ink: "#493729"
  primary-hover: "#f8d4a7"
  control-hover: "#fff9ff"
  floating-panel: "#f0ebf6"
typography:
  wordmark:
    fontFamily: 'Silkscreen, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "1"
  wordmark-mobile:
    fontSize: "12px"
  title:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 650
    lineHeight: "20px"
  body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "13px"
    fontWeight: 400
  button:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "12px"
    fontWeight: 600
  label:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "11px"
    lineHeight: "20px"
  metadata:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "10px"
  shortcut:
    fontFamily: '"Segoe UI", sans-serif'
    fontSize: "11px"
rounded:
  pixel-control: "2px"
  field: "3px"
  control: "4px"
  floating-panel: "6px"
spacing:
  tight: "4px"
  compact: "6px"
  control-gap: "8px"
  related: "10px"
  group: "12px"
  panel: "18px"
  mobile-panel: "20px"
components:
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-hover:
    backgroundColor: "{colors.control-hover}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  tool-selected:
    backgroundColor: "{colors.selected}"
    borderColor: "{colors.selected-line}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "35px"
  number-field:
    rounded: "{rounded.field}"
    padding: "2px 4px"
    width: "43px"
    height: "23px"
  segmented-control:
    rounded: "{rounded.control}"
    padding: "2px"
  material-map-row:
    rounded: "{rounded.control}"
  floating-panel:
    backgroundColor: "{colors.floating-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.floating-panel}"
    padding: "17px"
    width: "310px"
---

# Design System: Texelpad

## Overview

**Creative North Star: "A small material painting workbench"**

Texelpad follows the user's Aseprite-inspired direction: compact, pleasant, low-fi and almost toy-like. A lavender shell and pale lilac controls frame a light gray studio. Small outlined controls feel like familiar art-editor tools; amber makes export and the selected painting tool easy to find.

The model and its material are the visual subject. Pixel detail comes from the painted geometry, map previews and palette. The wordmark uses Silkscreen; interface controls use a readable system sans and English copy throughout, including accessible labels, tooltips, errors and export choices.

**Key Characteristics:**
- Lavender controls around a dominant light gray studio.
- Compact square tools, restrained amber emphasis and visible selection states.
- Pixelated material previews with editable numeric controls.
- English interface copy and keyboard-visible focus.

## Colors

The palette combines quiet lavender surfaces, dark plum text and warm amber actions. Frontmatter records the normative values extracted from the implementation.

### Primary

- **Warm amber** (`accent`): the export action.
- **Muted warm beige** (`selected`): the active tool, with a subdued warm border (`selected-line`).
- **Deep brown** (`primary-ink`): text on amber actions.
- **Light amber** (`primary-hover`): hover feedback for the primary action.

### Secondary

- **Focus violet** (`focus`): keyboard focus outlines and the text caret.

### Neutral

- **Lavender shell** (`shell`): the application base.
- **Pale lilac panel** (`panel`): painting tools and material controls.
- **Muted lavender bar** (`topbar`): the compact file and history toolbar.
- **Light gray studio** (`studio`): the canvas surround and processing overlay base.
- **Plum ink** (`ink`) and **muted plum** (`muted`): primary and supporting copy.
- **Lavender line** (`line`): internal separators and shortcut-key borders.
- **Pale control** (`control`) and **near-white control hover** (`control-hover`): ordinary buttons.
- **Floating lilac** (`floating-panel`): export and help panels.

The project color palette is user content rather than an interface accent scale. New projects receive 11 editable starter colors (three neutrals and eight muted colors); store the resulting palette in the project. Starter colors are not fixed UI tokens and do not replace existing saved palettes. The sidecar's generated tonal strips are inspection metadata; they are not additional approved UI tokens.

## Typography

The interface uses Segoe UI with system-ui and sans-serif fallbacks. The Texelpad wordmark alone uses Silkscreen Regular, self-hosted as WOFF2 with its OFL license. Preloading the small font file keeps the title ready early; font-display: swap preserves visible text during loading.

### Hierarchy

- **Title**: section headings such as Pixelisation and Lighting.
- **Body**: inherited interface text.
- **Button**: file actions and export.
- **Label**: slider labels, numeric fields and preview headings.
- **Metadata**: map dimensions and supporting descriptions.
- **Shortcut**: compact keycap labels.

The Texelpad wordmark uses Silkscreen at 16px on desktop and 12px on mobile, regular weight, unit line height and zero letter spacing. It stays on one line; controls and numeric fields keep the interface font. Numeric fields and dimensions use tabular numerals. Supporting notes use a relaxed line height (1.6 or 1.65) within the otherwise dense editor.

**The English Interface Rule.** Keep visible copy, accessible names, errors, tooltips and export labels in English.

## Layout

The desktop workspace has two equal 278px panels around a flexible studio. The left panel starts with Diffuse / Specular / Glow tabs, followed by the selected texture, tools and palette. A permanent Render panel on the right contains Pixelisation and Lighting with matching switches and parameters. There are no Paint / Render mode tabs or panel-opening buttons. Both panels stay visible and scroll independently. Desktop scroll areas reserve equal gutter space on both edges, keeping the visible left and right insets symmetric whether or not scrolling is needed; the map header uses the same gutters to align with its content. Horizontal padding stays compact (6px at the standard desktop width, plus the browser gutter on each edge; 12px without panel gutters on mobile). The left map tabs stay fixed; the right panel starts directly with Pixelisation and has no separate Render title row. Below the 48px top bar, the workspace fills the remaining height. Successful file operations and session recovery are silent: there are no opened, saved, loaded or downloaded toast notifications. Import errors and model UV limitations remain visible in the dismissible error banner; ongoing file processing keeps its busy indicator.

At widths of 1600px and above, both panels become 300px. From 761px through 1100px, both become 244px, with tighter padding and a smaller wordmark.

At 760px and below, the 92px top bar places Project, Edit and Export on its first row and the model control on its second row. The text wordmark remains visible on small screens; there is no app icon. The workspace scrolls vertically, with a sticky studio taking 30dvh (180px to 280px) above the painting and Render panels in sequence. Render remains present without an overlay, accordion or extra mode switch. There is no fixed bottom navigation. Painting tools are a horizontally centered group of 36px squares on desktop and 44px squares on mobile or coarse-pointer devices; texture import and effect switches use 44px touch targets.

Use small repeated gaps for related controls and 24px between major groups. Spacing separates the groups; avoid a border around every block. The project palette is a compact grid of swatches with a plus tile: 32px minimum swatch width on desktop and 40px on mobile. Texture previews retain their aspect ratio inside a bounded checkerboard surface.

## Elevation & Depth

Depth comes primarily from tonal separation and thin borders. Ordinary buttons add a light inset top edge; selected tools use a flat fill and border. Small controls use restrained local shadows. Export, help and error surfaces share the floating-panel shadow recorded in the sidecar. There are no elevated card stacks.

The primary button moves down by 1px when pressed. The pixelation switch moves its thumb with a 150ms ease-out transition. The export panel enters with opacity and a 6px upward offset resolved over 160ms; reduced motion removes the offset. CSS reduced-motion handling disables transitions and animation.

## Shapes

Controls are compact rectangles with lightly rounded corners. The frontmatter radius roles describe pixel controls, numeric fields, ordinary controls and floating panels. Fine one-pixel borders and modest inset highlights give the low-fi controls their tactile character.

Exceptions have a purpose: the pixelation switch and soft-brush cursor are round, while the pencil cursor is square. Map previews and palette swatches preserve crisp pixel rendering. Icons are line SVGs, and key hints use bordered keycaps.

## Components

### Buttons

Ordinary buttons use pale controls, plum text and a thin lavender border. Export uses warm amber with a brown border and text. Both retain a minimum height of 34px, an inset highlight and a 1px pressed displacement. Disabled buttons reduce opacity and use the default cursor. Keyboard focus uses the shared violet outline (2px, offset 3px).

Icon buttons provide compact actions for history, framing, map upload and panel dismissal. Their accessible names remain available when visible text is absent.

### Project commands and model import

The desktop top bar uses an 18px gap between its main groups. The top bar groups New project, Open project and Save project in one compact Project menu, with Ctrl+O / Ctrl+S hints. Project and Edit form one compact command group: 4px between their buttons, 8px horizontal button padding and 4px between each label and chevron. The desktop model control follows Edit with the same 4px gap. Edit immediately follows Project and contains Undo and Redo with Ctrl+Z / Ctrl+Shift+Z hints and disabled states when their history stack is empty. Their keyboard shortcuts also work while a command menu is open. Export remains directly available. The wordmark has no app icon. The menu supports arrow keys, Home / End, Escape and Tab, restores focus to its trigger when dismissed, and cannot paint the model when an outside click closes it. New project confirms before discarding unsaved changes. It clears the model, maps and history, restores starter palettes and resets default editor settings. Startup is an empty Untitled project with the studio floor grid; no sample model is loaded. Empty projects can be saved and reopened before importing geometry.

The model control follows Edit in the desktop top bar. With a loaded model, its filename and chevron open a menu containing the full name, triangle count and Replace model. Long names truncate in the bar and wrap in the menu. Empty projects show a direct Load model button with a folder-and-inward-arrow icon. It shares the standard button shape and size with Export, using the neutral control background and border instead of amber. On mobile, the model occupies the second top-bar row. There is no Frame model button in the viewport; F still resets the camera view. OBJ / FBX loading and confirmation before replacing unsaved work are unchanged.

### Painting tools

Three outlined SVG tools (pencil, brush and eraser) form the compact Paint group. Color contains the eyedropper inside the swatch popover for all three maps. The entire Color field is hidden while Eraser is selected; choosing Pencil or Brush restores it with its saved swatches and selection. The I shortcut remains available. Orbit has no separate toolbar button; right-drag and the H shortcut remain available. The active tool receives a muted warm beige fill and subdued warm border, without an inset highlight. There is no duplicate tool-name or shortcut row below the buttons. Palette swatches use an outline and checkmark for selection.

### Inputs / Fields

Each slider pairs an English label with a right-aligned numeric input. The input has a pale fill, a thin lavender border and tabular numerals. Radix supplies the slider interaction; the visual track is narrow with a violet filled range and a small rectangular thumb. Mobile increases the input and thumb heights.

Keep slider stacks compact: brush fields use 3px vertical margins on desktop, and material fields and mobile brush fields use 4px. Preserve the full-width track and input and thumb sizes when reducing vertical space.

Diffuse / Specular / Glow are the only left-panel tabs. Left / Right and Home / End move focus and select the map immediately; the shared tab panel exposes the active map's label. The selected map remains part of project data. Render controls stay available in their separate right panel while painting or changing maps. Legacy editorTab and accordion preferences remain readable but do not hide either panel. Slider positions use their known thumb width immediately.

The bottom-right viewport control is Wireframe: a native checkbox and clickable label that overlays the model's triangle edges on its painted material in solid black (#000000, 100% opacity). The whole control toggles the checkbox; Space works when focused, with a visible focus outline and a 44px touch target. It is disabled without a model, starts off and its state is saved in the project. The floor grid stays visible independently over a uniform light gray background (#eeedf1), with quiet gray lines (#d3d0d9) and slightly stronger center lines (#b4afbe). The Wireframe control uses the light control surface and dark text, a lilac checkbox accent and focus outline; its label sits 1px above geometric center for optical alignment. The viewport has no solid floor plane, horizon band or ground-shadow receiver. There is no decorative Studio label or status dot in this corner. The editor omits the shortcut legend and standalone help button.

Color is the label for the project palette, a brush parameter at the same visual level as Size, Opacity and Hardness: a regular field label inside Brush settings, with the same 4px spacing between fields as the sliders and 8px below the label. For every map, it contains saved swatches and a plus tile with the same interaction. A single click selects a swatch immediately for painting without opening the editor. Double-click, long-press, right-click or F2 opens its anchored color popover; plus opens New color. Enter and Space select the focused swatch. The hint below the palette is horizontally centered. It and the swatch tooltips read "Double-click to change" for mouse input and "Long tap to change" for touch input. The primary pointer media query selects the copy, so narrowing a desktop window does not show touch instructions. Touch or pen holds open the editor after 500 ms; movement or cancellation aborts the hold, and releasing a completed hold leaves the editor open. The Diffuse popover holds a saturation/brightness field, hue slider and HEX input. Specular and Glow instead show a black-to-white slider and a numeric percentage. All popovers have the same compact Pick from model button and Done or Add color action. Remove is inside an existing color's popover. There is no separate current-color row or palette toolbar. Editing previews the brush color; Done commits the swatch, Escape or Cancel restores the original, and clicking outside commits a valid existing color. A new color is added only with Add color. Duplicate colors are identified in the popover and cannot be committed. Sampling temporarily hides the popover, then returns to it and restores the previous painting tool. The popover opens toward the studio when space permits, stays within the viewport, escapes the sidebar via a portal, and supports keyboard focus and sliders. Ctrl+S commits a valid existing swatch edit and saves the project; an unadded new color remains unsaved until Add color is used. Specular and Glow each save a separate grayscale palette in the project. Their swatches select the brush value without changing the Diffuse brush color. New projects start with 11 Diffuse colors (three neutrals and eight muted colors). Model replacement restores these starter colors; the first import keeps any prepared palette. Both grayscale palettes start with five gray swatches (black, 25%, 50%, 75%, white). Existing saved palettes, brush values and source maps remain exact. Older files without a Diffuse palette field automatically receive up to 11 representative colors from the original Diffuse map, independent of lighting and Pixelisation. Extraction ignores invisible RGB, weights coverage by alpha and groups close shades, using actual source colors ordered from dark to light. These swatches appear directly in Color and use the existing edit/save interactions, with no extra prompt or notification. Fully transparent maps yield an empty palette. Explicitly saved empty palettes stay empty. There is no standalone intensity panel.

### Navigation

Lighting uses the same switch and section layout as Pixelisation. On is Lit (the default), off is Unlit. Light rotation, Specular and Glow stay visible but disabled when Lighting is off; switching it on restores editing without changing any values. Both effect switches expose aria-checked and use a white thumb when enabled. There is no separate Shading row or Lit / Unlit selector.

The editor uses a painting panel on the left and a permanent Render panel on the right; mobile stacks both below the studio. The only Pixelisation switch sits next to its heading inside the Render panel. Its thumb is white when enabled. Its three settings stay visible but disabled when off, retaining their values. Model details and processing controls do not overlay the viewport. The switch controls the model, thumbnails and selected-map preview together and exposes aria-checked. The map preview has no separate Original / Pixels selector. Active map rows retain programmatic pressed states. Export choices select the saved output and do not toggle the preview.

### Map selector and texture preview

The left panel starts directly with Diffuse / Specular / Glow tabs, with 8px of space above them and an underline for the active map. Selecting a map changes it immediately. A large square live texture preview fills the panel width below the tabs. Rectangular maps retain their aspect ratio inside its checkerboard surface, with nearest-pixel rendering. The preview is always visible and directly paintable, with no popover. Controls overlay the upper corners of the preview, with the load button inset by 4px for optical alignment and the size badge inset by 8px: a square folder-and-inward-arrow button on the left, with the accessible name and tooltip Load texture, and the displayed map dimensions as noninteractive text on a translucent graphite badge at the right (72% opacity). The import button uses the same neutral light surface, border and interaction states as Load model. The dimension badge follows the rendered preview: processed width and height when Pixelisation is on, original active-map dimensions when it is off. It updates with Texels per pixel and map selection. There is no metadata row beneath the preview. The import target grows to 44px for touch. There is no ellipsis menu, thumbnail on each map choice, or format label. Texture controls belong to the left panel; Render stays on the right. Projects preserve the active map; legacy preview-visibility and editor-mode preferences are accepted but no longer affect the layout.

The UV toggle sits 4px from the bottom-left of the preview, with a compact neutral button and the same muted selected state as the painting tools. It has a 32px desktop height and a 44px touch target, exposes aria-pressed and keyboard focus, and is disabled without a model. The separate high-resolution canvas overlay draws UV edges with dark lines and a light halo for contrast on both dark and light textures. It does not intercept paint or enter exports. The preview accepts the current brush, pencil, eraser or eyedropper, with a brush-size cursor and pointer capture. Rectangular maps are painted in their fitted area; the surrounding letterbox remains inactive. Pointer cancellation, window blur, resize, map/tool changes and save finish the shared undoable stroke.

### Floating panels

Export uses a bordered lilac surface, small corner radius and floating shadow, anchored 6px below its trigger and aligned with the trigger's right edge at every viewport width. A single grid controls spacing: 16px outer padding, 12px between the heading, choices and download action, and 8px between choices. Choice rows have 10px padding with a roomier 16px left inset, with no visible radio circles or decorative icons. Native radio inputs remain visually hidden for keyboard and assistive-technology support; keyboard focus outlines the whole row. The close button aligns with the heading, at 24px on desktop and 44px for touch. Export presents Original and Pixel grid as radio choices with a visible selected treatment, then a full-width download action. The export choices have an accessible group label, with no introductory question or ZIP explanation paragraph. Escape closes export.

### Pixelisation controls

Pixelisation has its only switch beside the heading, then Texels per pixel, Dithering and Color levels. The redundant Shared grid readout is omitted; the current preview dimensions overlay the top-right corner of the selected preview. Brush and pixelisation controls have no inline explanatory notes. Color levels spans 2–256, initially 256 levels with 30% dithering. These existing controls process all three maps before lighting; the preview and Pixel grid export include the result. Original and saved project sources remain editable. Zero Dithering keeps nearest-level quantization; at 256 levels there is no color reduction to dither.

## Do's and Don'ts

### Do:
- **Do** retain the user-pinned Aseprite-inspired, compact, pleasant, low-fi character.
- **Do** keep the painted model visually dominant and its maps close to the editing controls.
- **Do** use amber for export and the selected painting tool, with lavender for structural surfaces.
- **Do** preserve sharp pixel rendering for maps and palette content.
- **Do** keep English labels and accessible names available across responsive states.
- **Do** preserve keyboard focus, pressed states and reduced-motion behavior.

### Don't:
- **Don't** replace the established lavender and graphite workbench with a generic dashboard identity.
- **Don't** spread pixel-font styling across interface labels; the implemented interface uses readable system sans.
- **Don't** use generated sidecar tonal strips as new interface tokens without an explicit design change.
- **Don't** treat the demonstration model or editable paint palette as a required brand illustration.

<!-- Evidence: src/style.css, src/App.tsx, src/ui/controls.tsx, PRODUCT.md and .impeccable/editor-brief.md. Current composition review images are native screenshots from an isolated automation-owned Chromium; older reference captures may use DOM + WebGL composites. Procedural geometry and texture fixtures live only in tests/fixtures/demo.ts; there are no shipping external raster identity assets. -->


## Editor tab references
The structural references inspected for this change were [Instagram's Filters / Adjustments editor](https://mobbin.com/screens/c8d43240-780e-4b15-ab0e-484d343a1d39) and [Visual Electric's Tools / Adjustments / Properties sidebar](https://mobbin.com/screens/29d6ce22-b621-499f-abf7-757955a18a2c). They informed the fixed task tabs beside the working canvas. The map selector follows the user's workflow; the selected texture now has a permanent square preview in the panel. The lavender theme, typography, brush behavior and material pipeline remain project-specific. The Wix reference was dropped because its left navigation did not match this panel.

The command grouping references inspected for the compact header were [Canva's File menu](https://mobbin.com/screens/17f18671-94fc-43c7-82a4-a6f47762495f) and [Figma's File menu](https://mobbin.com/screens/513f87b8-1e3e-49fc-a96b-f845a0971879). This editor uses a single level with only its three project commands; the existing palette and studio appearance are retained.

The final composition uses [Jitter's mode tabs](https://mobbin.com/screens/46f65180-3df4-41aa-a62d-7a91632cc742) and [Krea AI's property modes](https://mobbin.com/screens/26034a96-934d-4a5c-bd25-06d3af820c5a) as references for putting modes above their controls. Actual reference images were inspected. The filename menu and placement of the Pixelisation switch are this editor's approved adaptation. Native Chromium screenshots of Paint and Render at desktop/mobile sizes are in `.impeccable/review/editor-composition-*.png`.

The user requested permanent equal-width side panels after reviewing the mode hierarchy: painting on the left, Render on the right, and map tabs at the top of painting. Native verification screenshots are `.impeccable/review/split-panels-*.png`.

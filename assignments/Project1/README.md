# Golden Spiral Composition (황금 나선 컴포지션)

> This README was written by Claude (Claude Code, Claude Opus 5.5) from the source code. Every prompt sent to Claude for this project is listed in [llm-prompts.md](llm-prompts.md).

MAT236 Project 1, Drawing Tool. A p5.js drawing tool where every gesture is snapped to the golden ratio (1 : 1.618).

## Design principle

The tool is meant to let anyone build a composition in golden proportions without measuring anything. The user decides *where* to divide, color, and animate; the tool decides the exact proportion.

- **Golden proportions by default.** The canvas is a golden rectangle (1000 × 618). A straight line across a cell is moved to 0.382 or 0.618 of that cell's side, whichever is nearer to the line. A spiral takes the largest golden rectangle that fits in its cell. Whatever the user draws, the result is built from golden divisions.
- **The gesture is the command.** There are no modes or menus. A line cuts a cell, a line traced along a bar removes it, a spiral drawn inward starts a spiral, and a spiral drawn outward stops one. The shape of the gesture matches what it makes.
- **No words.** The interface is a logo, six color swatches, and three icon buttons. The tool opens on an example composition instead of a blank canvas, so the user first sees what kind of picture the tool makes and has something to change right away.
- **A small palette.** Red, yellow, and blue, plus black, gray, and white. A new spiral colors itself with the brush color and the other primaries.
- **Movement that leaves room for the user.** Spirals keep flowing toward their center. Pieces that enter from the outside come in white, so there is always something left to color. A spiral can be stopped in place to keep one moment.
- **Limits that keep the picture readable.** Cells and spirals below a minimum size cannot be created, so pieces never shrink to slivers hidden under the black bars.

## How to use

| Do this | Result |
|---|---|
| Draw a straight line across a cell | Cuts that cell at the golden point (0.382 or 0.618) nearer to the line. The black bar spans only that cell. |
| Trace a line along a black bar | Removes that cut and every cut inside it. The merged cell takes the color of the larger half (white if that half was itself divided). |
| Draw a spiral clockwise, winding inward | Fills the cell with a flowing golden spiral, centered near where the stroke ended. On a stopped spiral, starts it again. |
| Draw a spiral counter-clockwise, winding outward, on a spiral | Stops it after its current step. Doing it again on a stopped spiral removes the spiral and leaves a white cell. |
| Click | Paints the cell, or the single spiral piece under the cursor, with the brush color. |
| Double click | Returns the cell, or the spiral piece under the cursor, to white. |
| Click a swatch on the right rail | Picks the brush color. |
| Rail buttons, top to bottom | Undo · back to the opening composition · save the painting as a PNG |

Any other stroke does nothing.

## Running the project

- **Files:** `index.html`, `sketch.js`, `style.css`. No assets are loaded.
- **Library:** p5.js 1.11.13, loaded from the jsDelivr CDN, so an internet connection is needed. No other libraries.
- **Local:** serve this folder with a local web server and open `index.html` (for example VS Code Live Server, or `python3 -m http.server` in this folder and then `http://localhost:8000`).
- **p5.js Web Editor:** paste `sketch.js` into a new sketch at editor.p5js.org and press Play.
- **Input:** mouse only, in a desktop browser. There are no keyboard controls.
- **Window size:** the whole tool scales to fit the browser window and rescales when the window is resized.
- **Size limits:** a cut needs both resulting pieces to be at least 30 px along the divided side, so the side must be about 79 px or longer. A new spiral needs the cell's shorter side to be at least 60 px. Sizes are in canvas units (1000 × 618), before scaling to the window.
- **Spiral gesture:** the stroke needs to turn about one and a third full turns or more, mostly in one direction.
- **Spiral timing:** each spiral holds still for 2.6 s, then takes a 1.3 s step in which every piece turns a quarter turn and shrinks by 1/1.618 toward the center.
- **Undo:** up to 100 steps. Undo also restores where a spiral was in its animation.
- **Save:** the PNG (`golden-composition.png`) contains only the painting, not the rail, at its on-screen size.

## LLM use

The code and this README were produced with Claude through Claude Code (Claude Fable 5.1 and Claude Opus 5.5). All prompts, with dates, are in [llm-prompts.md](llm-prompts.md).

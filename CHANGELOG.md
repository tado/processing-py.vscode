# Changelog

## 0.2.0

- The wizard no longer asks for a template: every project is generated from a single
  `sketch.py` (`setup()` with `size(600, 400)`, `draw()` with `background(0.9)`).
  The wizard is now project name → parent folder.
- Removed the Basic / Interactive / Static templates.

## 0.1.0

- Initial version: project wizard (Basic / Interactive / Static templates), Explorer "Create Here",
  optional `uv sync`, Run / Stop Sketch via `uv run`.
- Type-stub overlay in `typings/processing_py/` so Pylance knows runtime globals
  (`mouse_x`, `width`, `frame_count`, …); command "Update Type Stubs" and setting
  `processingPy.generateTypeStubs`.

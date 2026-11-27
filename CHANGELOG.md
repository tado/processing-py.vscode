# Changelog

## 0.4.0

- `uv sync` now runs automatically after a project is created: the default of
  `processingPy.syncAfterCreate` is `always` (was `ask`). Set it to `never` to run `uv sync`
  yourself, or `ask` for the previous behavior.

## 0.3.0

- The default `processingPy.pythonVersion` for new projects is now `3.14` (was `3.12`).
  processing-py 0.4.0 ships 3.14 wheels for macOS arm64, Windows x64 and Linux x86_64.
  Existing projects keep their own `.python-version`.

## 0.2.1

- README: added a Requirements section with the official uv install scripts (macOS / Linux,
  Windows) and a link to the uv installation page, plus Marketplace / VSIX installation steps.
  Sections now follow the same layout as uv Simple Project Generator.
- Set the extension publisher to `tadokoro`.

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

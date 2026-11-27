# processing-py Project Generator

A VS Code extension that creates and runs [processing-py](https://libprocessing.processingfoundation.org/getting-started/processing-py/)
(Python bindings for libprocessing) sketch projects, managed with [uv](https://docs.astral.sh/uv/).

The workflow follows the official getting-started guide (`uv add processing-py` → `uv run sketch.py`).
The project wizard is modeled on the p5.js 2.x Project Generator.

## Requirements

This extension needs [uv](https://docs.astral.sh/uv/), which installs Python and processing-py
for each project and runs the sketches. Install it with the official script:

- macOS / Linux:

  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- Windows (PowerShell):

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

For Homebrew, WinGet, pip and other methods, see the
[uv installation page](https://docs.astral.sh/uv/getting-started/installation/).
Restart VS Code after installing so that it can find `uv`.

processing-py also needs a platform with its wheels (0.4.0): macOS Apple Silicon, Windows x64 or
Linux x86_64 (glibc 2.34+). The wizard warns on other platforms (e.g. Intel Mac).

## Installation

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tadokoro.processing-py-project-generator):

- In VS Code, open the Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`), search for
  **processing-py Project Generator**, and click **Install**, or
- run `code --install-extension tadokoro.processing-py-project-generator`.

A `.vsix` file is also attached to each [GitHub release](https://github.com/tado/processing-py.vscode/releases);
install it with **Extensions: Install from VSIX...** in the Command Palette.

Then install uv (see [Requirements](#requirements)) and run **processing-py: Create a new processing-py Project**
from the Command Palette.

## Features

- **processing-py: Create a new processing-py Project** (Command Palette)
  1. Project name
  2. Parent folder
  3. Optionally runs `uv sync` to install Python and processing-py into `.venv`
  4. Opens the project in this window or a new one and shows `sketch.py`
- **Create processing-py Project Here**: right-click a folder in the Explorer
  (asks only for the project name).
- **processing-py: Run Sketch** (▶ in the editor title bar, `Cmd+R` / `Ctrl+R`):
  runs `uv run <file>` in a dedicated terminal. Running again restarts the sketch.
- **processing-py: Stop Sketch**: closes the sketch terminal and its window.
- **processing-py: Update Type Stubs**: rewrites `typings/processing_py/` (see below).

## Generated project

Every project starts from the same `sketch.py`:

```python
from processing_py import *

def setup():
    size(600, 400)

def draw():
    background(0.9)

run()
```

```
my-sketch/
├── sketch.py             # from processing_py import * … run()
├── assets/               # load_image("x.png") resolves to assets/x.png
├── pyproject.toml        # dependencies = ["processing-py"]
├── .python-version       # 3.14 (configurable)
├── README.md
├── .gitignore
└── .vscode/
    ├── settings.json     # interpreter = .venv, wildcard-import warning off
    ├── launch.json       # debugpy: run sketch / current file
    └── extensions.json   # recommends ms-python.python
```

## Type stubs for runtime globals

processing-py's bundled stubs do not declare the globals that only exist at runtime
(`mouse_x`, `mouse_y`, `width`, `height`, `key`, `frame_count`, … 24 names in 0.4.0), so Pylance
would report them as undefined. After `uv sync`, the extension:

1. imports `processing_py` in the project's `.venv` to list those globals and the package version,
2. copies the package's `.pyi` files to `typings/processing_py/` (Pylance's default `stubPath`,
   which wins over installed packages),
3. appends declarations such as `mouse_x: float`, taking each type from the matching
   `Graphics` property or `_dyn_*()` helper in the original stub.

The overlay records the processing-py version in its first line and is regenerated when `uv.lock`
changes to a new version. Names the upstream stub already declares are never added; if upstream
declares them all, the overlay is removed. A `typings/processing_py/` folder that the extension
did not create is left untouched. Disable with `processingPy.generateTypeStubs`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `processingPy.uvPath` | `uv` | Path to uv. If set to `uv`, `~/.local/bin`, `~/.cargo/bin` and Homebrew locations are also tried. |
| `processingPy.pythonVersion` | `3.14` | Written to `.python-version`; also sets `requires-python`. |
| `processingPy.packageVersion` | *(empty = latest)* | `0.4.0` pins exactly; `>=0.4,<0.5` is used as-is. |
| `processingPy.syncAfterCreate` | `ask` | `ask` / `always` / `never` run `uv sync` after creation. |
| `processingPy.generateTypeStubs` | `true` | Generate the `typings/processing_py/` overlay described above. |

## Known issues

- The stub overlay is a workaround for processing-py's stubs; the real fix belongs upstream in
  libprocessing. Pylance may need a moment (or "Python: Restart Language Server") to pick up a
  freshly written `typings/` folder.
- `from processing_py import *` exports its own `math`, `round`, `pow`, `set` and `filter`.
  Import standard-library modules after the wildcard import.

## Development

```bash
npm install
npm test          # compile + unit tests (node:test)
```

Press `F5` in VS Code to launch an Extension Development Host. Package with `npx @vscode/vsce package`.

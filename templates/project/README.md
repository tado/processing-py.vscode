# {{PROJECT_NAME}}

A [processing-py](https://libprocessing.processingfoundation.org/getting-started/processing-py/) sketch.

## Getting started

This project is managed with [uv](https://docs.astral.sh/uv/).

```bash
# install Python and dependencies into .venv
uv sync

# run the sketch
uv run {{SKETCH_FILE}}
```

In VS Code you can also press the **Run Sketch** (▶) button in the editor title bar
or use `Cmd+R` / `Ctrl+R`.

## Project structure

```
{{PROJECT_NAME}}/
├── {{SKETCH_FILE}}      # your sketch
├── assets/        # images, fonts, shaders (load_image("x.png") -> assets/x.png)
├── pyproject.toml # dependencies (processing-py)
└── .python-version
```

## Notes

- `from processing_py import *` exports its own `math`, `round`, `pow`, `set` and `filter`.
  Import standard-library modules **after** the wildcard import.
- libprocessing is an experimental project and its API may change.

## Resources

- [processing-py getting started](https://libprocessing.processingfoundation.org/getting-started/processing-py/)
- [Python API reference](https://processing.github.io/libprocessing/)
- [libprocessing on GitHub](https://github.com/processing/libprocessing)

# assets

Put images, fonts, shaders and 3D models here.

Paths passed to `load_image()`, `load_font()`, `load_shader()` and `load_gltf()`
are resolved relative to this folder:

```python
img = load_image("photo.png")  # -> assets/photo.png
```

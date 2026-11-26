import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import {
  PackageInfo,
  TYPINGS_DIR,
  buildOverlay,
  declaredNames,
  dynHelperTypes,
  ensureStubs,
  graphicsPropertyTypes,
  readOverlayMarker,
  venvPython,
} from '../stubs';

// Shaped like processing-py 0.4.0's __init__.pyi.
const STUB = `from .math import Affine2, Vec2 as Vec5
from typing import Any, Final, final

@final
class Color:
    @property
    def width(self, /) -> str: ...

@final
class Graphics:
    @property
    def focused(self, /) -> bool: ...
    @property
    def key(self, /) -> str | None: ...
    @property
    def mouse_x(self, /) -> float: ...
    def circle(self, /, cx: float, cy: float, d: float) -> None: ...
    @property
    def width(self, /) -> int: ...

@final
class Image:
    @property
    def height(self, /) -> int: ...

VecIter = Any

def _dyn_frame_count() -> int: ...
def circle(cx: float, cy: float, d: float) -> None: ...
def pixel_density(density: float | None = None) -> float: ...
def run() -> None: ...
`;

const INFO: PackageInfo = {
  version: '0.4.0',
  dynamic: ['width', 'height', 'focused', 'key', 'mouse_x', 'pixel_density', 'frame_count', 'window_x', 'mystery'],
  packageDir: '',
};

test('declaredNames finds defs, classes, assignments and import aliases', () => {
  const names = declaredNames(STUB);
  for (const n of ['Graphics', 'Color', 'circle', 'run', 'pixel_density', 'VecIter', 'Any', 'Vec5', 'Affine2']) {
    assert.ok(names.has(n), n);
  }
  assert.ok(!names.has('mouse_x'));
  assert.ok(!names.has('Vec2'), 'aliased import binds the alias only');
});

test('graphicsPropertyTypes reads only class Graphics', () => {
  const t = graphicsPropertyTypes(STUB);
  assert.equal(t.get('width'), 'int'); // not Color.width
  assert.equal(t.get('key'), 'str | None');
  assert.equal(t.get('mouse_x'), 'float');
  assert.equal(t.get('height'), undefined); // belongs to Image
  assert.ok(!t.has('circle'));
});

test('dynHelperTypes', () => {
  assert.equal(dynHelperTypes(STUB).get('frame_count'), 'int');
});

test('buildOverlay appends only missing globals with the best known type', () => {
  const overlay = buildOverlay(STUB, INFO)!;
  assert.ok(overlay.startsWith('# processing-py-overlay: version=0.4.0 generator=1\n'));
  assert.ok(overlay.includes(STUB.trimEnd()), 'original stub is kept verbatim');
  const tail = overlay.split('# --- Runtime globals')[1];
  assert.match(tail, /^width: int$/m);
  assert.match(tail, /^key: str \| None$/m);
  assert.match(tail, /^mouse_x: float$/m);
  assert.match(tail, /^focused: bool$/m);
  assert.match(tail, /^frame_count: int$/m);
  assert.match(tail, /^window_x: int$/m);
  assert.match(tail, /^height: Any$/m); // no Graphics property in this fixture
  assert.match(tail, /^mystery: Any$/m);
  assert.doesNotMatch(tail, /^pixel_density:/m, 'already declared as a function');
  assert.doesNotMatch(tail, /^from typing import Any/m, 'Any is already imported');
});

test('buildOverlay returns undefined once upstream declares everything', () => {
  const fixed = STUB + INFO.dynamic.map((n) => `${n}: Any`).join('\n') + '\n';
  assert.equal(buildOverlay(fixed, INFO), undefined);
});

test('buildOverlay imports Any when the stub does not', () => {
  const overlay = buildOverlay('def run() -> None: ...\n', { ...INFO, dynamic: ['mystery'] })!;
  assert.match(overlay, /^from typing import Any as Any$/m);
});

async function fakeProject(): Promise<{ project: string; pkg: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ppy-stubs-'));
  const project = path.join(root, 'proj');
  const pkg = path.join(root, 'site-packages', 'processing_py');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(pkg, '__init__.pyi'), STUB);
  await fs.writeFile(path.join(pkg, 'math.pyi'), 'class Vec2: ...\n');
  await fs.writeFile(path.join(pkg, '__init__.py'), '# runtime\n');
  const python = venvPython(project, process.platform);
  await fs.mkdir(path.dirname(python), { recursive: true });
  await fs.writeFile(python, '');
  return { project, pkg, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('ensureStubs writes, skips when up to date, rewrites on version change', async () => {
  const { project, pkg, cleanup } = await fakeProject();
  try {
    let version = '0.4.0';
    let calls = 0;
    const query = async () => {
      calls++;
      return { ...INFO, version, packageDir: pkg };
    };

    const first = await ensureStubs(project, process.platform, { query });
    assert.equal(first.status, 'written');
    const out = path.join(project, TYPINGS_DIR);
    assert.deepEqual((await fs.readdir(out)).sort(), ['__init__.pyi', 'math.pyi']);
    assert.deepEqual(await readOverlayMarker(project), { version: '0.4.0', generator: 1 });

    assert.equal((await ensureStubs(project, process.platform, { query })).status, 'up-to-date');
    assert.equal((await ensureStubs(project, process.platform, { query, force: true })).status, 'written');

    version = '0.5.0';
    assert.equal((await ensureStubs(project, process.platform, { query })).status, 'written');
    assert.equal((await readOverlayMarker(project))?.version, '0.5.0');
    assert.equal(calls, 4);
  } finally {
    await cleanup();
  }
});

test('ensureStubs removes its overlay when upstream no longer needs it', async () => {
  const { project, pkg, cleanup } = await fakeProject();
  try {
    const query = async () => ({ ...INFO, packageDir: pkg });
    await ensureStubs(project, process.platform, { query });
    await fs.writeFile(path.join(pkg, '__init__.pyi'), STUB + INFO.dynamic.map((n) => `${n}: Any`).join('\n'));
    const r = await ensureStubs(project, process.platform, { query, force: true });
    assert.equal(r.status, 'not-needed');
    await assert.rejects(fs.access(path.join(project, 'typings')));
  } finally {
    await cleanup();
  }
});

test('ensureStubs leaves a user-written typings/processing_py alone', async () => {
  const { project, pkg, cleanup } = await fakeProject();
  try {
    const mine = path.join(project, TYPINGS_DIR, '__init__.pyi');
    await fs.mkdir(path.dirname(mine), { recursive: true });
    await fs.writeFile(mine, '# my own stub\n');
    const r = await ensureStubs(project, process.platform, { query: async () => ({ ...INFO, packageDir: pkg }) });
    assert.equal(r.status, 'not-ours');
    assert.equal(await fs.readFile(mine, 'utf8'), '# my own stub\n');
  } finally {
    await cleanup();
  }
});

test('ensureStubs reports a missing venv', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ppy-stubs-'));
  try {
    assert.equal((await ensureStubs(root, process.platform)).status, 'no-venv');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

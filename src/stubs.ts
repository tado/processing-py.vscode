/**
 * Type-stub overlay for processing-py.
 *
 * processing-py's bundled `__init__.pyi` does not declare the "dynamic" module
 * globals (mouse_x, width, key, frame_count, ...) that exist at runtime through
 * the module `__getattr__` and through `run()` copying them into the sketch's
 * globals. Pylance therefore reports them as undefined after
 * `from processing_py import *`.
 *
 * We copy the package's stubs into `<project>/typings/processing_py/` (Pylance's
 * default `python.analysis.stubPath`, which takes precedence over installed
 * packages) and append declarations for the missing names. Names the upstream
 * stub already declares are never re-declared, so once upstream fixes its stubs
 * the overlay stops being written.
 *
 * Free of any `vscode` import so it can be unit-tested with plain Node.
 */
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export const OVERLAY_GENERATOR_VERSION = 1;
export const TYPINGS_DIR = path.join('typings', 'processing_py');
const MARKER_PREFIX = '# processing-py-overlay:';

/** What the project's environment tells us about the installed package. */
export interface PackageInfo {
  version: string;
  /** Runtime-only module globals. */
  dynamic: string[];
  /** Directory of the installed `processing_py` package. */
  packageDir: string;
}

/** Fallback types for globals the stub gives no type information for. */
const FALLBACK_TYPES: Record<string, string> = {
  display_width: 'int',
  display_height: 'int',
  window_x: 'int',
  window_y: 'int',
};

const QUERY_SCRIPT = [
  'import json, os, importlib.metadata as m',
  'import processing_py as p',
  'names = list(getattr(p, "_DYNAMIC", ()))',
  // Names exported via __all__ but not present in the module dict are served by __getattr__.
  'names += [n for n in getattr(p, "__all__", ()) if n not in vars(p) and n not in names]',
  'print(json.dumps({"version": m.version("processing-py"), "dynamic": names, "packageDir": os.path.dirname(p.__file__)}))',
].join('\n');

export function venvPython(projectDir: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? path.join(projectDir, '.venv', 'Scripts', 'python.exe')
    : path.join(projectDir, '.venv', 'bin', 'python');
}

/** Imports processing_py inside the project's venv (no window is opened). */
export function queryPackage(python: string, cwd: string): Promise<PackageInfo> {
  return new Promise((resolve, reject) => {
    execFile(python, ['-I', '-c', QUERY_SCRIPT], { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr}`.trim()));
        return;
      }
      try {
        // Native code may log to stdout; the JSON is the last line.
        const line = stdout.trim().split(/\r?\n/).pop() ?? '';
        const info = JSON.parse(line) as PackageInfo;
        resolve(info);
      } catch (e) {
        reject(new Error(`Unexpected output from processing_py query: ${stdout}`));
      }
    });
  });
}

/** Names declared at module level in a .pyi (def / class / annotated or assigned names). */
export function declaredNames(pyi: string): Set<string> {
  const names = new Set<string>();
  for (const m of pyi.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm)) {
    names.add(m[1]);
  }
  for (const m of pyi.matchAll(/^([A-Za-z_]\w*)\s*[:=]/gm)) {
    names.add(m[1]);
  }
  for (const m of pyi.matchAll(/^from\s+\S+\s+import\s+(.+)$/gm)) {
    for (const part of m[1].split(',')) {
      const alias = /(\w+)(?:\s+as\s+(\w+))?/.exec(part.trim());
      if (alias) {
        names.add(alias[2] ?? alias[1]);
      }
    }
  }
  return names;
}

/** Return types of `@property` methods in `class Graphics` (e.g. mouse_x -> float). */
export function graphicsPropertyTypes(pyi: string): Map<string, string> {
  const types = new Map<string, string>();
  const start = pyi.search(/^class Graphics\b.*:\s*$/m);
  if (start < 0) {
    return types;
  }
  const rest = pyi.slice(start);
  const firstNewline = rest.indexOf('\n');
  // The class body ends at the next non-indented, non-empty line.
  const endRel = rest.slice(firstNewline + 1).search(/^\S/m);
  const body = endRel < 0 ? rest : rest.slice(0, firstNewline + 1 + endRel);
  for (const m of body.matchAll(/@property\s*\n\s+def\s+(\w+)\(\s*self\s*(?:,\s*\/\s*)?\)\s*->\s*(.+?):/g)) {
    types.set(m[1], m[2].trim());
  }
  return types;
}

/** Return types of module-level `_dyn_<name>()` helpers (frame_count, delta_time, ...). */
export function dynHelperTypes(pyi: string): Map<string, string> {
  const types = new Map<string, string>();
  for (const m of pyi.matchAll(/^def\s+_dyn_(\w+)\(\s*\)\s*->\s*(.+?):/gm)) {
    types.set(m[1], m[2].trim());
  }
  return types;
}

/**
 * Builds the overlay `__init__.pyi`, or returns undefined when the upstream stub
 * already declares every dynamic global.
 */
export function buildOverlay(originalPyi: string, info: PackageInfo): string | undefined {
  const declared = declaredNames(originalPyi);
  const missing = [...new Set(info.dynamic)].filter((n) => /^[A-Za-z]\w*$/.test(n) && !declared.has(n));
  if (missing.length === 0) {
    return undefined;
  }
  const props = graphicsPropertyTypes(originalPyi);
  const dyn = dynHelperTypes(originalPyi);
  const needsAny = missing.some((n) => !props.has(n) && !dyn.has(n) && !FALLBACK_TYPES[n]);

  const lines = missing.map((n) => `${n}: ${props.get(n) ?? dyn.get(n) ?? FALLBACK_TYPES[n] ?? 'Any'}`);
  const header =
    `${MARKER_PREFIX} version=${info.version} generator=${OVERLAY_GENERATOR_VERSION}\n` +
    '# Generated by processing-py Project Generator. Do not edit: it is regenerated\n' +
    '# when processing-py is updated. Delete the typings/ folder to remove it.\n';
  const footer =
    '\n\n# --- Runtime globals not declared by the upstream stub ---\n' +
    (needsAny && !declared.has('Any') ? 'from typing import Any as Any\n' : '') +
    lines.join('\n') +
    '\n';
  return header + originalPyi.replace(/\s*$/, '') + footer;
}

/** Reads the marker of an existing overlay, if any. */
export async function readOverlayMarker(
  projectDir: string,
): Promise<{ version: string; generator: number } | undefined> {
  try {
    const text = await fs.readFile(path.join(projectDir, TYPINGS_DIR, '__init__.pyi'), 'utf8');
    const m = new RegExp(`^${MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} version=(\\S+) generator=(\\d+)`).exec(
      text,
    );
    return m ? { version: m[1], generator: Number(m[2]) } : undefined;
  } catch {
    return undefined;
  }
}

export type StubResult =
  | { status: 'written'; version: string; names: number }
  | { status: 'up-to-date'; version: string }
  | { status: 'not-needed'; version: string }
  | { status: 'no-venv' }
  | { status: 'not-ours' };

/**
 * Creates or refreshes the overlay for a project. Never touches a
 * typings/processing_py folder that it did not create.
 */
export async function ensureStubs(
  projectDir: string,
  platform: NodeJS.Platform,
  options: { force?: boolean; query?: (python: string, cwd: string) => Promise<PackageInfo> } = {},
): Promise<StubResult> {
  const python = venvPython(projectDir, platform);
  try {
    await fs.access(python);
  } catch {
    return { status: 'no-venv' };
  }

  const outDir = path.join(projectDir, TYPINGS_DIR);
  const marker = await readOverlayMarker(projectDir);
  const outExists = await fs
    .access(outDir)
    .then(() => true)
    .catch(() => false);
  if (outExists && !marker) {
    return { status: 'not-ours' };
  }

  const info = await (options.query ?? queryPackage)(python, projectDir);
  if (
    !options.force &&
    marker &&
    marker.version === info.version &&
    marker.generator === OVERLAY_GENERATOR_VERSION
  ) {
    return { status: 'up-to-date', version: info.version };
  }

  const originalPyi = await fs.readFile(path.join(info.packageDir, '__init__.pyi'), 'utf8');
  const overlay = buildOverlay(originalPyi, info);
  if (!overlay) {
    if (marker) {
      await fs.rm(outDir, { recursive: true, force: true });
      await removeIfEmpty(path.join(projectDir, 'typings'));
    }
    return { status: 'not-needed', version: info.version };
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  // Copy sibling stubs (e.g. math.pyi) so relative imports in __init__.pyi resolve.
  for (const entry of await fs.readdir(info.packageDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.pyi') && entry.name !== '__init__.pyi') {
      await fs.copyFile(path.join(info.packageDir, entry.name), path.join(outDir, entry.name));
    }
  }
  await fs.writeFile(path.join(outDir, '__init__.pyi'), overlay, 'utf8');

  const names = overlay.split('# --- Runtime globals')[1]?.match(/^\w+:/gm)?.length ?? 0;
  return { status: 'written', version: info.version, names };
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    if ((await fs.readdir(dir)).length === 0) {
      await fs.rmdir(dir);
    }
  } catch {
    // ignore
  }
}

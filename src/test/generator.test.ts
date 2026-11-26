import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import {
  dependencySpec,
  generateProject,
  isProcessingPyProject,
  requiresPython,
  toPackageName,
  validateProjectName,
} from '../generator';

const templatesRoot = path.resolve(__dirname, '..', '..', 'templates');

test('validateProjectName', () => {
  assert.equal(validateProjectName('my-sketch'), undefined);
  assert.equal(validateProjectName('My Sketch 2'), undefined);
  assert.ok(validateProjectName(''));
  assert.ok(validateProjectName('   '));
  assert.ok(validateProjectName('../evil'));
  assert.ok(validateProjectName('a/b'));
  assert.ok(validateProjectName('-leading'));
});

test('toPackageName normalizes to PEP 503', () => {
  assert.equal(toPackageName('My Sketch'), 'my-sketch');
  assert.equal(toPackageName('foo__bar..baz'), 'foo-bar-baz');
  assert.equal(toPackageName('  Hello  '), 'hello');
});

test('dependencySpec', () => {
  assert.equal(dependencySpec(''), 'processing-py');
  assert.equal(dependencySpec('0.4.0'), 'processing-py==0.4.0');
  assert.equal(dependencySpec('>=0.4,<0.5'), 'processing-py>=0.4,<0.5');
});

test('requiresPython', () => {
  assert.equal(requiresPython('3.12'), '3.12');
  assert.equal(requiresPython('3.13.1'), '3.13');
  assert.equal(requiresPython('garbage'), '3.11');
});

test('isProcessingPyProject', () => {
  assert.ok(isProcessingPyProject('dependencies = [\n  "processing-py",\n]'));
  assert.ok(isProcessingPyProject('dependencies = ["processing-py>=0.4"]'));
  assert.ok(isProcessingPyProject("dependencies = ['processing_py==0.4.0']"));
  assert.ok(!isProcessingPyProject('dependencies = ["processing-pyx"]'));
  assert.ok(!isProcessingPyProject('dependencies = ["numpy"]'));
});

test('generateProject writes a complete project', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ppy-gen-'));
  try {
    const dir = await generateProject(templatesRoot, {
      projectName: 'My Sketch',
      parentDir: parent,
      pythonVersion: '3.12',
      packageVersion: '',
      platform: 'darwin',
    });
    assert.equal(dir, path.join(parent, 'My Sketch'));

    const expected = [
      'pyproject.toml',
      '.python-version',
      '.gitignore',
      'README.md',
      'sketch.py',
      'assets/README.md',
      '.vscode/settings.json',
      '.vscode/launch.json',
      '.vscode/extensions.json',
    ];
    for (const f of expected) {
      await fs.access(path.join(dir, f));
    }

    // No leftover placeholders anywhere.
    for (const f of expected) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      assert.ok(!/\{\{[A-Z_]+\}\}/.test(text), `${f} still has a placeholder`);
    }

    const pyproject = await fs.readFile(path.join(dir, 'pyproject.toml'), 'utf8');
    assert.match(pyproject, /name = "my-sketch"/);
    assert.match(pyproject, /requires-python = ">=3.12"/);
    assert.ok(isProcessingPyProject(pyproject));
    assert.equal((await fs.readFile(path.join(dir, '.python-version'), 'utf8')).trim(), '3.12');

    const sketch = await fs.readFile(path.join(dir, 'sketch.py'), 'utf8');
    assert.match(sketch, /^from processing_py import \*/);
    assert.match(sketch, /\brun\(\)\s*$/);
    assert.equal(sketch, await fs.readFile(path.join(templatesRoot, 'project', 'sketch.py'), 'utf8'));

    const settings = JSON.parse(await fs.readFile(path.join(dir, '.vscode/settings.json'), 'utf8'));
    assert.equal(settings['python.defaultInterpreterPath'], '${workspaceFolder}/.venv/bin/python');
    JSON.parse(await fs.readFile(path.join(dir, '.vscode/launch.json'), 'utf8'));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('generateProject refuses to merge into an existing folder', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ppy-gen-'));
  try {
    await fs.mkdir(path.join(parent, 'taken'));
    await assert.rejects(
      generateProject(templatesRoot, {
        projectName: 'taken',
        parentDir: parent,
        pythonVersion: '3.12',
        packageVersion: '',
        platform: 'linux',
      }),
      /EEXIST/,
    );
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('Windows interpreter path', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ppy-gen-'));
  try {
    const dir = await generateProject(templatesRoot, {
      projectName: 'win',
      parentDir: parent,
      pythonVersion: '3.12',
      packageVersion: '0.4.0',
      platform: 'win32',
    });
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.vscode/settings.json'), 'utf8'));
    assert.equal(settings['python.defaultInterpreterPath'], '${workspaceFolder}\\.venv\\Scripts\\python.exe');
    assert.match(await fs.readFile(path.join(dir, 'pyproject.toml'), 'utf8'), /"processing-py==0\.4\.0"/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

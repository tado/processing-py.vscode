import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  SKETCH_FILE,
  generateProject,
  isProcessingPyProject,
  validateProjectName,
} from './generator';
import { isSupportedPlatform, supportedPlatformsLabel } from './platform';
import { SketchRunner, findProjectRoot } from './runner';
import { StubResult, ensureStubs } from './stubs';
import { UV_INSTALL_URL, findUv, uvSync } from './uv';

const CONTEXT_IN_PROJECT = 'processingPy.inProject';
const PENDING_OPEN_KEY = 'processingPy.pendingOpenFile';

let output: vscode.OutputChannel;

function config() {
  const c = vscode.workspace.getConfiguration('processingPy');
  return {
    uvPath: c.get<string>('uvPath', 'uv'),
    pythonVersion: c.get<string>('pythonVersion', '3.14'),
    packageVersion: c.get<string>('packageVersion', ''),
    syncAfterCreate: c.get<'ask' | 'always' | 'never'>('syncAfterCreate', 'ask'),
    generateTypeStubs: c.get<boolean>('generateTypeStubs', true),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('processing-py');
  const runner = new SketchRunner();
  context.subscriptions.push(output, runner);

  context.subscriptions.push(
    vscode.commands.registerCommand('processingPy.createProject', () => createProject(context)),
    vscode.commands.registerCommand('processingPy.createProjectHere', (uri?: vscode.Uri) =>
      createProject(context, uri),
    ),
    vscode.commands.registerCommand('processingPy.runSketch', (uri?: vscode.Uri) => runSketch(runner, uri)),
    vscode.commands.registerCommand('processingPy.stopSketch', () => runner.stop()),
    vscode.commands.registerCommand('processingPy.updateTypeStubs', () => updateTypeStubsCommand()),
  );

  void updateProjectContext().then((roots) => refreshStubsQuietly(roots));
  const watcher = vscode.workspace.createFileSystemWatcher('**/pyproject.toml');
  watcher.onDidCreate(() => updateProjectContext());
  watcher.onDidChange(() => updateProjectContext());
  watcher.onDidDelete(() => updateProjectContext());
  context.subscriptions.push(watcher, vscode.workspace.onDidChangeWorkspaceFolders(() => updateProjectContext()));

  // `uv sync` / `uv add processing-py==…` rewrite uv.lock: refresh the stub overlay.
  const lockWatcher = vscode.workspace.createFileSystemWatcher('**/uv.lock');
  const onLock = (uri: vscode.Uri) => scheduleStubRefresh(path.dirname(uri.fsPath));
  lockWatcher.onDidCreate(onLock);
  lockWatcher.onDidChange(onLock);
  context.subscriptions.push(lockWatcher);

  void openPendingFile(context);
}

export function deactivate(): void {
  // Disposables are cleaned up through context.subscriptions.
}

// ---------------------------------------------------------------------------
// Project creation
// ---------------------------------------------------------------------------

async function createProject(context: vscode.ExtensionContext, targetParent?: vscode.Uri): Promise<void> {
  if (!isSupportedPlatform(process.platform, process.arch)) {
    const choice = await vscode.window.showWarningMessage(
      `processing-py publishes binaries only for ${supportedPlatformsLabel()}. ` +
        `This machine is ${process.platform}-${process.arch}, so installing it will probably fail.`,
      { modal: true },
      'Continue Anyway',
    );
    if (choice !== 'Continue Anyway') {
      return;
    }
  }

  const projectName = await vscode.window.showInputBox({
    // "Create Here" already knows the parent folder, so it has a single step.
    title: targetParent ? 'New processing-py Project' : 'New processing-py Project (1/2)',
    prompt: 'Enter project name',
    placeHolder: 'my-sketch',
    value: 'my-sketch',
    validateInput: validateProjectName,
  });
  if (projectName === undefined) {
    return;
  }

  let parentUri = targetParent;
  if (!parentUri) {
    const folders = await vscode.window.showOpenDialog({
      title: 'New processing-py Project (2/2)',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Parent Folder',
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    if (!folders || folders.length === 0) {
      return;
    }
    parentUri = folders[0];
  }

  const name = projectName.trim();
  const parentDir = parentUri.fsPath;
  const projectUri = vscode.Uri.file(path.join(parentDir, name));

  if (fs.existsSync(projectUri.fsPath)) {
    const choice = await vscode.window.showWarningMessage(
      `A folder named "${name}" already exists in ${parentDir}. Move it to the trash and create a new project?`,
      { modal: true },
      'Overwrite',
    );
    if (choice !== 'Overwrite') {
      return;
    }
    try {
      await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: true });
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not remove the existing folder: ${errorMessage(err)}`);
      return;
    }
  }

  const cfg = config();
  let projectDir: string;
  try {
    projectDir = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating processing-py project' },
      () =>
        generateProject(vscode.Uri.joinPath(context.extensionUri, 'templates').fsPath, {
          projectName: name,
          parentDir,
          pythonVersion: cfg.pythonVersion,
          packageVersion: cfg.packageVersion,
          platform: process.platform,
        }),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to create project: ${errorMessage(err)}`);
    return;
  }
  output.appendLine(`Created ${projectDir}`);

  const synced = await maybeSync(projectDir, cfg);
  await offerOpen(context, projectDir, synced);
}

async function maybeSync(projectDir: string, cfg: ReturnType<typeof config>): Promise<boolean> {
  if (cfg.syncAfterCreate === 'never') {
    return false;
  }
  if (cfg.syncAfterCreate === 'ask') {
    const choice = await vscode.window.showInformationMessage(
      'Install Python and processing-py into the project now? (runs "uv sync")',
      'Install',
      'Later',
    );
    if (choice !== 'Install') {
      return false;
    }
  }

  const uv = await findUv(cfg.uvPath);
  if (!uv) {
    const choice = await vscode.window.showWarningMessage(
      'uv was not found. Install uv, then run "uv sync" in the project folder.',
      'How to Install uv',
    );
    if (choice) {
      void vscode.env.openExternal(vscode.Uri.parse(UV_INSTALL_URL));
    }
    return false;
  }

  output.appendLine(`> ${uv.command} sync   (${uv.version}, cwd: ${projectDir})`);
  const code = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'uv sync: installing processing-py',
      cancellable: true,
    },
    (progress, token) => {
      const handle = uvSync(uv.command, projectDir, (text) => {
        output.append(text);
        const last = text.trim().split(/\r?\n/).pop();
        if (last) {
          progress.report({ message: last.slice(0, 80) });
        }
      });
      token.onCancellationRequested(() => handle.cancel());
      return handle.done;
    },
  );

  if (code !== 0) {
    const choice = await vscode.window.showErrorMessage(
      `uv sync failed (exit code ${code}). You can retry with "uv sync" in the project folder.`,
      'Show Output',
    );
    if (choice) {
      output.show();
    }
    return false;
  }

  if (cfg.generateTypeStubs) {
    await runEnsureStubs(projectDir, false);
  }
  return true;
}

async function offerOpen(context: vscode.ExtensionContext, projectDir: string, synced: boolean): Promise<void> {
  const projectUri = vscode.Uri.file(projectDir);
  const sketchUri = vscode.Uri.joinPath(projectUri, SKETCH_FILE);

  // Created inside the current workspace (e.g. via the Explorer context menu):
  // just open the sketch.
  if (vscode.workspace.getWorkspaceFolder(projectUri)) {
    await vscode.window.showTextDocument(sketchUri);
    void updateProjectContext();
    void vscode.window.showInformationMessage(
      synced ? 'processing-py project created. Press ▶ to run the sketch.' : 'processing-py project created.',
    );
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `processing-py project "${path.basename(projectDir)}" created.`,
    'Open Project',
    'Open in New Window',
  );
  if (!choice) {
    return;
  }
  // The window reloads on openFolder, so remember which file to show afterwards.
  await context.globalState.update(PENDING_OPEN_KEY, sketchUri.fsPath);
  await vscode.commands.executeCommand('vscode.openFolder', projectUri, {
    forceNewWindow: choice === 'Open in New Window',
  });
}

async function openPendingFile(context: vscode.ExtensionContext): Promise<void> {
  const pending = context.globalState.get<string>(PENDING_OPEN_KEY);
  if (!pending) {
    return;
  }
  const uri = vscode.Uri.file(pending);
  if (!vscode.workspace.getWorkspaceFolder(uri)) {
    return; // Not this window's project; another window will pick it up.
  }
  await context.globalState.update(PENDING_OPEN_KEY, undefined);
  if (fs.existsSync(pending)) {
    await vscode.window.showTextDocument(uri);
  }
}

// ---------------------------------------------------------------------------
// Running sketches
// ---------------------------------------------------------------------------

async function runSketch(runner: SketchRunner, uri?: vscode.Uri): Promise<void> {
  let target = uri && uri.scheme === 'file' ? uri : vscode.window.activeTextEditor?.document.uri;

  if (!target || target.scheme !== 'file' || !target.fsPath.endsWith('.py')) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const fallback = folder && vscode.Uri.joinPath(folder.uri, SKETCH_FILE);
    if (!fallback || !fs.existsSync(fallback.fsPath)) {
      void vscode.window.showErrorMessage('Open a Python sketch file to run it.');
      return;
    }
    target = fallback;
  }

  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === target!.fsPath);
  if (doc?.isDirty) {
    await doc.save();
  }

  const uv = await findUv(config().uvPath);
  if (!uv) {
    const choice = await vscode.window.showErrorMessage(
      'uv was not found. processing-py sketches are run with "uv run".',
      'How to Install uv',
    );
    if (choice) {
      void vscode.env.openExternal(vscode.Uri.parse(UV_INSTALL_URL));
    }
    return;
  }

  if (!findProjectRoot(path.dirname(target.fsPath))) {
    void vscode.window.showWarningMessage(
      'No pyproject.toml was found for this file; running it with "uv run" in its own folder.',
    );
  }
  runner.run(uv.command, target.fsPath);
}

// ---------------------------------------------------------------------------
// Type-stub overlay (see stubs.ts)
// ---------------------------------------------------------------------------

/** Projects with a refresh in flight, to avoid overlapping runs. */
const stubJobs = new Map<string, Promise<StubResult | undefined>>();
const stubTimers = new Map<string, NodeJS.Timeout>();

function runEnsureStubs(projectDir: string, force: boolean): Promise<StubResult | undefined> {
  const running = stubJobs.get(projectDir);
  if (running) {
    return running;
  }
  const job = ensureStubs(projectDir, process.platform, { force })
    .then((result) => {
      output.appendLine(`Type stubs (${projectDir}): ${describeStubResult(result)}`);
      return result;
    })
    .catch((err) => {
      output.appendLine(`Type stubs (${projectDir}) failed: ${errorMessage(err)}`);
      return undefined;
    })
    .finally(() => stubJobs.delete(projectDir));
  stubJobs.set(projectDir, job);
  return job;
}

function scheduleStubRefresh(projectDir: string): void {
  if (!config().generateTypeStubs) {
    return;
  }
  clearTimeout(stubTimers.get(projectDir));
  // uv writes uv.lock before it finishes installing into .venv; wait a moment.
  stubTimers.set(
    projectDir,
    setTimeout(() => {
      stubTimers.delete(projectDir);
      void isProcessingPyDir(projectDir).then((ok) => (ok ? runEnsureStubs(projectDir, false) : undefined));
    }, 3000),
  );
}

function refreshStubsQuietly(roots: string[]): void {
  if (!config().generateTypeStubs) {
    return;
  }
  for (const root of roots) {
    void runEnsureStubs(root, false);
  }
}

async function updateTypeStubsCommand(): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const fromEditor = active?.scheme === 'file' ? findProjectRoot(path.dirname(active.fsPath)) : undefined;
  const roots =
    fromEditor && (await isProcessingPyDir(fromEditor)) ? [fromEditor] : await updateProjectContext();
  if (roots.length === 0) {
    void vscode.window.showWarningMessage('No processing-py project (pyproject.toml) was found.');
    return;
  }
  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Updating processing-py type stubs' },
    () => Promise.all(roots.map((r) => runEnsureStubs(r, true))),
  );
  const messages = results.map((r, i) =>
    roots.length > 1 ? `${path.basename(roots[i])}: ${describeStubResult(r)}` : describeStubResult(r),
  );
  if (results.some((r) => r?.status === 'no-venv')) {
    void vscode.window.showWarningMessage(`${messages.join(' / ')}. Run "uv sync" first.`);
  } else {
    void vscode.window.showInformationMessage(messages.join(' / '));
  }
}

function describeStubResult(r: StubResult | undefined): string {
  switch (r?.status) {
    case 'written':
      return `added ${r.names} runtime globals to typings/processing_py (processing-py ${r.version})`;
    case 'up-to-date':
      return `up to date (processing-py ${r.version})`;
    case 'not-needed':
      return `not needed: processing-py ${r.version} already declares all globals`;
    case 'no-venv':
      return '.venv not found';
    case 'not-ours':
      return 'typings/processing_py exists and was not created by this extension; left untouched';
    default:
      return 'failed (see the processing-py output channel)';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isProcessingPyDir(dir: string): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(dir, 'pyproject.toml')));
    return isProcessingPyProject(Buffer.from(bytes).toString('utf8'));
  } catch {
    return false;
  }
}

/** Updates the `processingPy.inProject` context key and returns the project roots found. */
async function updateProjectContext(): Promise<string[]> {
  const roots: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidates = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/pyproject.toml'),
      '**/{.venv,node_modules,.git}/**',
      20,
    );
    for (const file of candidates) {
      const dir = path.dirname(file.fsPath);
      if (await isProcessingPyDir(dir)) {
        roots.push(dir);
      }
    }
  }
  await vscode.commands.executeCommand('setContext', CONTEXT_IN_PROJECT, roots.length > 0);
  return roots;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Platforms for which processing-py publishes binary wheels (checked against
 * processing-py 0.4.0 on PyPI). There is no sdist-friendly build path for most
 * users, so other platforms are very likely to fail at `uv sync`.
 */
const SUPPORTED: ReadonlyArray<{ platform: NodeJS.Platform; arch: string; label: string }> = [
  { platform: 'darwin', arch: 'arm64', label: 'macOS (Apple Silicon)' },
  { platform: 'win32', arch: 'x64', label: 'Windows x64' },
  { platform: 'linux', arch: 'x64', label: 'Linux x86_64 (glibc 2.34+)' },
];

export function isSupportedPlatform(platform: NodeJS.Platform, arch: string): boolean {
  return SUPPORTED.some((s) => s.platform === platform && s.arch === arch);
}

export function supportedPlatformsLabel(): string {
  return SUPPORTED.map((s) => s.label).join(', ');
}

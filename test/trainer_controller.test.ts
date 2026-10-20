/**
 * The Trainer panel only renders (#600 S16c): every store it reads and every write it makes is
 * its controller's (`src/app/enroll/trainerController.ts`), and what the controller reaches outside
 * the Trainer goes through the SDK's app half where a seam exists (the recording config and
 * destination, the binder, the hush). These pin the boundary as imports, and the recording
 * config's folder reader, which the app provides to the SDK's store.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import { provideRecordingFolderReader, useRecordingConfig } from '@thoremin/sdk-ui/recording/config';

/** The module specifiers a source imports (static, dynamic and side-effect imports). */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const from = /(?:\bimport\b|\bexport\b)[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const dyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const bare = /^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const re of [from, dyn, bare]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) specs.push(m[1]);
  }
  return specs;
}

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('the Trainer panel renders; its controller holds the stores', () => {
  it('the panel imports no store, no recording module, no binding module and no dispatcher', () => {
    const imports = importSpecifiers(source('src/app/TrainerPanel.tsx'));
    const forbidden = imports.filter((s) =>
      /^\.\/(store|toolsStore|tools|dispatchDial)$|^\.\/recording\/|^\.\/enroll\/(store|prefs|liveVector|categoryBinding)$|^@thoremin\/sdk-ui\/(recording|host|dials)/.test(s),
    );
    expect(forbidden).toEqual([]);
    expect(imports).toContain('./enroll/trainerController');
  });

  it('the controller reaches the recording config, the binder and the hush through the SDK', () => {
    const imports = importSpecifiers(source('src/app/enroll/trainerController.ts'));
    expect(imports).toEqual(expect.arrayContaining(['@thoremin/sdk-ui/recording/config', '@thoremin/sdk-ui/recording/destination', '@thoremin/sdk-ui/enroll/binder', '@thoremin/sdk-ui/host']));
    expect(imports.filter((s) => /recording\/configStore|categoryBinding|dispatchDial/.test(s))).toEqual([]);
  });
});

describe('the recording config store reads the remembered folder through the app\'s reader', () => {
  let withdraw = () => {};
  afterEach(() => withdraw());

  it('refreshFolder reads what the provided reader says, and nothing once it is withdrawn', async () => {
    withdraw = provideRecordingFolderReader(async () => 'Takes');
    await useRecordingConfig.getState().refreshFolder();
    expect(useRecordingConfig.getState().folder).toBe('Takes');
    withdraw();
    await useRecordingConfig.getState().refreshFolder();
    expect(useRecordingConfig.getState().folder).toBeNull();
  });
});

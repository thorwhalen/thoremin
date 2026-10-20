/**
 * Where the next take goes, in words (#257, #391 item 3): `describeTakeDestination`
 * as one data table, its four cases. The no-picker row wins over everything else: a
 * remembered folder or a `directory` preference left over from a Chromium session
 * cannot be honoured by a browser that has no picker, so it must not be offered.
 */
import { describe, it, expect } from 'vitest';
import { describeTakeDestination, type TakeDestination, type TakeDestinationInput } from '@thoremin/sdk-ui/recording/destination';

const ROWS: { case: string; input: TakeDestinationInput; expected: TakeDestination }[] = [
  {
    case: 'no folder picker in this browser',
    input: { location: 'directory', folder: 'takes', supported: false },
    expected: {
      text: 'Takes download as a zip (this browser has no folder picker; Chrome or Edge has one).',
      chooseLabel: null,
      offerDownloads: false,
    },
  },
  {
    case: 'Downloads chosen',
    input: { location: 'downloads', folder: 'takes', supported: true },
    expected: { text: 'Takes download as a zip.', chooseLabel: 'Save takes to a folder...', offerDownloads: false },
  },
  {
    case: 'a folder chosen and remembered',
    input: { location: 'directory', folder: 'takes', supported: true },
    expected: { text: 'Takes are saved to the folder "takes".', chooseLabel: 'Change folder...', offerDownloads: true },
  },
  {
    case: 'a folder chosen but none remembered (asked for at take start)',
    input: { location: 'directory', folder: null, supported: true },
    expected: {
      text: 'Takes are saved to a folder you will be asked for when the take starts.',
      chooseLabel: 'Choose folder...',
      offerDownloads: true,
    },
  },
];

describe('describeTakeDestination', () => {
  it.each(ROWS)('$case', ({ input, expected }) => {
    expect(describeTakeDestination(input)).toEqual(expected);
  });

  it('the no-picker sentence holds whatever the preference and the remembered folder', () => {
    for (const location of ['directory', 'downloads'] as const) {
      for (const folder of ['takes', null]) {
        expect(describeTakeDestination({ location, folder, supported: false })).toEqual(ROWS[0].expected);
      }
    }
  });
});

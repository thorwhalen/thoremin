/**
 * Cut the orchestra's soundfont (#187 PR 5, D10 on #168): MuseScore_General.sf3 trimmed
 * to the GM programs the shipped scores use (`BANK_PROGRAMS`), written as SF3 with the
 * source's Ogg-compressed samples kept as they are (no re-encoding, so no second
 * generation of loss).
 *
 * The source bank is generated data and never enters the repo: fetch it into a work
 * directory, then run this with the source and the output path.
 *
 *   curl -LO https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3
 *   npx vite-node scripts/orchestra/cut_soundfont.ts -- <src.sf3> public/soundfonts/orchestra.sf3
 *
 * It prints what it kept and the size, which the PR states against the 15 MB
 * self-hosting threshold. The licence travels beside the output
 * (`public/soundfonts/LICENSE.md`, MuseScore_General's own, MIT).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { BANK_PROGRAMS } from '@/slices/conductor/nodes/orchestra_map';

const [src, out] = process.argv.slice(2).filter((a) => a !== '--');
if (!src || !out) {
  console.error('usage: cut_soundfont.ts <MuseScore_General.sf3> <out.sf3>');
  process.exit(2);
}

await BasicSoundBank.isSF3DecoderReady;
const bytes = readFileSync(src);
const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const keep = new Set(BANK_PROGRAMS);
for (const preset of [...bank.presets]) {
  const melodicBank0 = preset.bankMSB === 0 && preset.bankLSB === 0 && !preset.isGMGSDrum;
  if (!(melodicBank0 && keep.has(preset.program))) bank.deletePreset(preset);
}
bank.removeUnusedElements();
const kept = bank.presets.map((p) => `${p.program} ${p.name}`).sort((a, b) => parseInt(a) - parseInt(b));
const missing = BANK_PROGRAMS.filter((p) => !bank.presets.some((q) => q.program === p));
if (missing.length) {
  console.error(`the source bank lacks programs ${missing.join(', ')}`);
  process.exit(1);
}
bank.soundBankInfo.name = 'thoremin orchestra (cut from MuseScore_General 0.2)';
const written = bank.writeSF2({ software: 'thoremin scripts/orchestra/cut_soundfont.ts' });
writeFileSync(out, new Uint8Array(written));
console.log(kept.join('\n'));
console.log(`${bank.presets.length} presets, ${bank.instruments.length} instruments, ${bank.samples.length} samples`);
console.log(`${out}: ${(written.byteLength / 1e6).toFixed(2)} MB (source ${(bytes.byteLength / 1e6).toFixed(2)} MB)`);

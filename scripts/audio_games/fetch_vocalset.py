"""Cut the sung-vowel fixtures from VocalSet (Wilkins et al. 2018, CC BY 4.0, Zenodo 1442513).

Reads single members of the 2 GB archive over HTTP range requests (no full download), and cuts
each to a 3 s mono 11025 Hz 16-bit WAV (the formant analyser's own rate) with ffmpeg. The fixture
README carries the attribution; docs/research/datasets.md the row.

usage: python3 -I fetch_vocalset.py <out dir>
"""
import io
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

URL = "https://zenodo.org/api/records/1442513/files/VocalSet11.zip/content"
SINGERS = {"male2": "m2", "female1": "f1"}
TAKES = [("scales/straight", "scales_straight", "aiu"), ("arpeggios/vibrato", "arpeggios_vibrato", "aeiou")]
START_S, LENGTH_S = "0.5", "3"


class HttpFile(io.RawIOBase):
    """A seekable read-only view of a remote file, one range request per read."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-0"})) as r:
            self.size = int(r.headers["Content-Range"].split("/")[1])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size or not len(b):
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        with urllib.request.urlopen(urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})) as r:
            data = r.read()
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    archive = zipfile.ZipFile(io.BufferedReader(HttpFile(URL), buffer_size=1 << 20))
    names = set(archive.namelist())
    with tempfile.TemporaryDirectory() as tmp:
        for folder, short in SINGERS.items():
            for path, stem, vowels in TAKES:
                for v in vowels:
                    member = f"FULL/{folder}/{path}/{short}_{stem}_{v}.wav"
                    if member not in names:
                        sys.exit(f"missing from the archive: {member}")
                    raw = Path(tmp) / "take.wav"
                    raw.write_bytes(archive.read(member))
                    dest = out / f"{short}_{stem}_{v}.wav"
                    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", START_S, "-t", LENGTH_S, "-i", str(raw), "-ac", "1", "-ar", "11025", "-sample_fmt", "s16", str(dest)], check=True)
                    print(dest.name)


if __name__ == "__main__":
    main(Path(sys.argv[1]))

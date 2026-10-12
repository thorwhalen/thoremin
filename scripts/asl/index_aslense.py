"""Index the Aslense HF dataset: filename -> part directory (written as TSV)."""
import sys
from huggingface_hub import HfApi
REPO = "ZahidYasinMittha/American-Sign-Language-Dataset"
out = sys.argv[1]
api = HfApi()
with open(out, "w") as f:
    for i in range(1, 12):
        n = 0
        for e in api.list_repo_tree(REPO, repo_type="dataset", path_in_repo=f"part_{i}"):
            f.write(f"{e.path}\t{getattr(e, 'size', 0)}\n"); n += 1
        print(f"part_{i}", n, flush=True)

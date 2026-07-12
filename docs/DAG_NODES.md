# DAG Node Catalog — moved

The node catalog is **generated from the node registry** (the SSOT) and lives in
[`docs/CATALOG.md`](CATALOG.md). Regenerate it with `npm run catalog`; it is also
served by the deployed app at `/thoremin/manual.html`.

This file used to be a second, hand-maintained catalog. It drifted (it documented
21 of 31 nodes, listed shipped nodes as "planned", and used pre-rename port names),
which is exactly why there is now only one. Do not reintroduce a hand-written node
list.

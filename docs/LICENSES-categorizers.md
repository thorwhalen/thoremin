# The shipped demo categorizers

- `demo-hand-shapes.json`: trained on hand features (angles and distances, no pixels, no landmarks) computed from one signer of **SignAlphaSet** (B. Garg, M. Kasar, A. Kashyap, A. Vats, G. Sharma, A. Hange, Mendeley Data, 2025, [doi:10.17632/8fmvr9m98w.3](https://doi.org/10.17632/8fmvr9m98w.3)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: the stillest second of the signer's B, A, G and O clips, as feature vectors, carved into four categories (open, fist, point, pinch). Provenance: `test/faces/shared_demo_categorizers.test.ts`, `test/helpers/real_hand_script.ts`.
- `demo-poses.json`, `demo-smile.json`: carved from thoremin's own scripted body and face; no third-party material.

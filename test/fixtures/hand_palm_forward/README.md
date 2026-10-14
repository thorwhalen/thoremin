# hand_palm_forward

Six MediaPipe hand landmark sets (three labelled `Right`, three `Left`, image keypoints in pixels with the model's raw `z`, plus world keypoints) of the ASL letter B: a flat hand, fingers up, the palm toward the camera. They pin the palm's sign per handedness label that `src/nodes/features/conductor_gesture.ts` reads (#457).

Source: landmarks extracted with MediaPipe Hands from images of "Images of ASL Alphabet Gestures" (Mendeley Data, doi:10.17632/48dg9vhmyk.2), licensed CC BY 4.0. Only the landmark coordinates are kept, no image. Each record's `id` is the source image's path in that dataset.

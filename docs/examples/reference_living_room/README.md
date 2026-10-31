# Reference living room — recipe

`reference.jpg` → `our_render.png` (see `reference_vs_build.png`).

- `steps/01…08` are the build steps, run in order with the `ab` toolkit (`run_step`), each into the collection **Reference Living Room**.
- `build_headless.py` rebuilds and renders it in headless Blender:
  `ENGINE=EEVEE blender -b --factory-startup --python docs/examples/reference_living_room/build_headless.py -- "$PWD" "$PWD/docs/examples/reference_living_room/steps" /tmp/out`
- `PROMPT.md` is the prompt to paste in the app (with the image attached).
- To remove it from a scene: delete the collection **Reference Living Room**.

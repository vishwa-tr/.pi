# Shotcut Video From The Command Line

## Summary

Shotcut is a front end over the MLT framework, and its portable build ships `melt`, `ffmpeg` and
`ffprobe`. A Shotcut project (`.mlt`) is MLT XML, so a script can write one, `melt` can render it
with no GUI, and Shotcut still opens it for review and hand edits.
[`shotcut.py`](../scripts/shotcut/shotcut.py) wraps that loop: **build** a project from a JSON
spec, **render** it, and pull **frames** to check the result without watching it.

Verified 2026-10-01 against Shotcut 25.08.16 (MLT 7.33, FFmpeg 7.1) on Windows: a spec with a
colour scene, a zoomed video clip, an image, crossfades, three overlapping titles and music built,
rendered at the right length and frame rate, and opened in Shotcut with its tracks intact. Linux
and macOS builds should work the same way but have not been run.

## Details

### Requirements

- Python 3.9+ (stdlib only).
- A Shotcut install or portable folder holding `melt`, `ffmpeg` and `ffprobe`. Point
  `SHOTCUT_DIR` at it, or pass `--shotcut-dir`. The script also looks in `<dir>/bin`.
- Fonts named in a spec must be installed; an unknown family silently falls back.

### Workflow

```bash
export SHOTCUT_DIR="<path to the Shotcut folder>"
S=~/.pi/agent/library/scripts/shotcut/shotcut.py

python $S build spec.json -o project.mlt               # spec -> Shotcut project
python $S render project.mlt -o preview.mp4 --preview  # half size, fast
python $S frames preview.mp4 -o sheet.png --count 16   # one contact sheet to eyeball
python $S frames preview.mp4 -o still.png --at 3.2,7.5 # full-size stills at chosen times
python $S render project.mlt -o final.mp4              # H.264 CRF 18 + AAC 256k, faststart
```

To review or polish by hand, open `project.mlt` in Shotcut. **Pick one source of truth per
project:** once a project has been edited and saved in Shotcut, running `build` again overwrites
those edits. Either keep editing the spec and treat Shotcut as a viewer, or stop building and
continue in Shotcut. `render` works on both.

All commands overwrite their outputs. Media paths in the spec are relative to the spec file and
are stored relative to the project file, so a project folder can be moved as a whole.

### Spec reference

See [`example-spec.json`](../scripts/shotcut/example-spec.json). Times are in seconds, sizes in
pixels, colours `#rrggbb` or `#aarrggbb` (alpha first). Unknown keys are rejected, so a typo fails
loudly instead of being ignored.

| Section | Key | Default | Meaning |
| --- | --- | --- | --- |
| top | `video` | 1920×1080, 30 fps | `width`, `height`, `fps` |
| top | `scene_audio` | `true` | `false` mutes the clips' own sound (V1) |
| `scenes[]` | `color` or `source` | — | solid colour, or a video/image file |
| | `duration` | file length − `in` | required for colours and images |
| | `in` | 0 | start point inside a video source |
| | `transition` | 0 | crossfade from the previous scene; shortens the timeline by that much |
| | `zoom` | — | `[from, to]` centred scale over the scene, e.g. `[1.0, 1.15]` |
| `titles[]` | `text`, `start`, `duration` | — | required; overlapping titles get their own tracks |
| | `font`, `size`, `weight`, `italic` | Sans, 80, 400 | weight 100–900 |
| | `color`, `outline`, `outline_color` | white, 0, black | outline width in pixels |
| | `background`, `padding` | transparent, 0 | box drawn behind the text only |
| | `box` | full frame | `[x, y, width, height]` the text is aligned within |
| | `halign`, `valign` | center, middle | left/center/right, top/middle/bottom |
| | `fade` | 0.3 | fade in and out; 0 disables |
| | `slide_from` | — | left/right/top/bottom, eased |
| | `slide_distance`, `slide_time` | 120, 0.6 | |
| `audio[]` | `source` | — | required; overlapping clips get their own tracks |
| | `start`, `in` | 0, 0 | timeline position, offset into the file |
| | `duration` | to the end of the timeline | clamped to the file's length |
| | `gain_db`, `fade_in`, `fade_out` | 0, 0, 0 | |

### What the project contains

The output follows Shotcut's own layout, so Shotcut shows normal tracks, clips and filters:
a `background` track, V1 for scenes, V2+ for titles, A1+ for audio. Crossfades are Shotcut
`lumaMix` transitions. Titles are transparent colour clips carrying a **Text: Simple**
(`dynamictext`) filter; zoom is **Size, Position & Rotate** (`affine`); audio uses the **Gain / Volume**,
**Fade In Audio** and **Fade Out Audio** filters. Keyframes use smooth easing.

### Pitfalls

- **Overlay tracks blend onto V1, not the track below.** In the tractor, the `frei0r.cairoblend`
  transition for every track above V1 needs `a_track` = V1. Blending onto the track below works
  until that track has a gap, and then everything above it lands on black.
- **Changing the output size resets the frame rate.** Passing `width`/`height` to `melt`'s
  consumer drops the project profile and falls back to 25 fps. Pass `frame_rate_num`,
  `frame_rate_den` and `progressive` with them; `render --preview` does.
- **`qtext` ignores `text=`.** On the `melt` command line its text goes in `argument=`; a wrong
  key draws the literal word "text". `dynamictext` uses `argument` too.
- **`dynamictext` defaults to top-left and an opaque background box.** Always set `halign`,
  `valign` and `bgcolour`; the script does.
- **`#word#` in title text is a keyword** to `dynamictext` (`#timecode#`, `#frame#`), so a pair of
  hashes may be substituted.
- **Elements must be defined before they are referenced** in MLT XML: producers, then the
  playlists and transition tractors that use them, then the main tractor.
- `melt` writes progress and FFmpeg warnings to stderr; in PowerShell this shows as a
  `NativeCommandError` even when the render succeeded. Check the exit code and the output file.

### Other tools in the Shotcut folder

- `whisper-cli` — speech-to-text, useful for generating captions from narration.
- `glaxnimate` — vector animation editor for animated titles and logos (exports Lottie/video).
- `ffplay` — quick playback of a render.

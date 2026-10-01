# Shotcut Video From The Command Line

## Summary

Shotcut is a front end over the MLT framework, and its portable build ships `melt`, `ffmpeg` and
`ffprobe`. A Shotcut project (`.mlt`) is MLT XML, so a script can write one, `melt` can render it
with no GUI, and Shotcut still opens it for review and hand edits.
[`shotcut.py`](../scripts/shotcut/shotcut.py) wraps that loop: **build** a project from a JSON
spec, **render** it, and pull **frames** to check the result without watching it.

Verified 2026-10-01 against Shotcut 25.08.16 (MLT 7.33, FFmpeg 7.1) on Windows: a spec with a
colour scene, a zoomed video clip, an image, crossfades, three overlapping titles and music built,
rendered at the right length and frame rate, and opened in Shotcut with its tracks intact. Full MLT rendering on Linux
and macOS remains unverified. Review verification on 2026-10-01 used Python 3.14 and FFmpeg
8.1.2 on Linux for synthetic-video frame extraction and contact sheets, plus regression tests
for project XML, input validation and output handling; no Shotcut/MLT renderer was available.

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

python "$S" build spec.json -o project.mlt               # spec -> Shotcut project
python "$S" render project.mlt -o preview.mp4 --preview  # half size, fast
python "$S" frames preview.mp4 -o sheet.png --count 16   # one contact sheet to eyeball
python "$S" frames preview.mp4 -o still.png --at 3.2,7.5 # full-size stills at chosen times
python "$S" render project.mlt -o final.mp4              # H.264 CRF 18 + AAC 256k, faststart
```

To review or polish by hand, open `project.mlt` in Shotcut. **Pick one source of truth per
project:** once a project has been edited and saved in Shotcut, running `build` again overwrites
those edits. Either keep editing the spec and treat Shotcut as a viewer, or stop building and
continue in Shotcut. `render` works on both.

Each completed output replaces an existing file only after a nonempty result is produced;
a failed output preserves the previous file. Inputs cannot also be output destinations.
A multi-still request may complete earlier files before a later extraction fails.
`--at` timestamps must be finite, nonnegative and before the video's end.

Media paths in the spec are relative to the spec file. Ordinary media resources are stored
relative to the project, but framed backdrops embed an absolute path and the project records
its build directory. Rebuild from the spec after relocating files; do not assume all projects
can be moved unchanged. Pass the global `--shotcut-dir` option before `build`, `render` or
`frames` when not using `SHOTCUT_DIR`.

### Spec reference

See [`example-spec.json`](../scripts/shotcut/example-spec.json). Times are in seconds, sizes in
pixels, colours `#rrggbb` or `#aarrggbb` (alpha first). Unknown keys are rejected, so a typo fails
loudly instead of being ignored.

| Section | Key | Default | Meaning |
| --- | --- | --- | --- |
| top | `video` | 1920×1080, 30 fps | positive even integer `width`/`height`; positive `fps` as an integer, decimal or rational string such as `"30000/1001"` |
| top | `scene_audio` | `true` | `false` mutes the clips' own sound (V1) |
| top | `backdrop` | black | image (PNG/SVG) shown under the whole timeline and behind framed scenes |
| `scenes[]` | `color` or `source` | — | solid colour, or a video/image file |
| | `duration` | file length − `in` | required for colours and images |
| | `in` | 0 | start point inside a video source |
| | `transition` | 0 | crossfade from the previous scene; shortens the timeline by that much |
| | `zoom` | — | `[from, to]` scale over the scene, e.g. `[1.0, 1.15]` |
| | `focus` | frame centre | `[x, y]` project pixel after source fitting that the zoom centres on; clamped to frame edges |
| | `crop` | — | `[x, y, width, height]` part of the source to keep, in project pixels |
| | `frame` | — | `[x, y, width, height]` box the scene is fitted into over the backdrop; `zoom` then scales the box |
| `titles[]` | `text` or `image`, `start`, `duration` | — | required; overlapping titles get their own tracks |
| | `image` | — | PNG/SVG overlay fitted into `box`; uses `box`, `halign`, `valign`, `fade`, `slide_*` |
| | `layer` | 0 | stacking order: higher layers always sit on higher tracks |
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
| | `duration` | to the end of the scene/title timeline | clamped to the file's length; explicit longer clips extend the timeline |
| | `gain_db`, `fade_in`, `fade_out` | 0, 0, 0 | |

### What the project contains

The output follows Shotcut's own layout, so Shotcut shows normal tracks, clips and filters:
a `background` track, V1 for scenes, V2+ for titles, A1+ for audio. Crossfades are Shotcut
`lumaMix` transitions. Titles are transparent colour clips carrying a **Text: Simple**
(`dynamictext`) filter; image overlays carry **Opacity** (`brightness` alpha) and
**Size, Position & Rotate**; zoom is **Size, Position & Rotate** (`affine`); audio uses the **Gain / Volume**,
**Fade In Audio** and **Fade Out Audio** filters. Keyframes use smooth easing.

### Pitfalls

- **Overlay tracks blend onto V1, not the track below.** In the tractor, the `frei0r.cairoblend`
  transition for every track above V1 needs `a_track` = V1. Blending onto the track below works
  until that track has a gap, and then everything above it lands on black. With a `backdrop`, V1 is
  blended too and every video track targets the background track (0) instead; the frame that comes
  out is the one the blends target, so a raw V1 target hides the backdrop.
- **Crossfades between transparent scenes turn grey.** The `luma` dissolve mixes alpha badly, so a
  scene shrunk into a `frame` over a backdrop must be opaque: the frame's `affine` filter takes the
  backdrop as its `background` (`qimage:<path>`), which `build` does whenever `backdrop` is set.
- **Overlap order is not start order.** Tracks are packed greedily, so an overlay that starts first
  can still land above one that starts later. Set `layer` whenever overlays must stack a set way.
- **A one-frame `melt ... in=N out=N` render does not seek video.** It returns an early source
  frame; check footage with a real render and `frames --at` instead.
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
- **SVG is a good overlay format.** Qt renders rounded rects, gradients, system fonts and
  `<image>` references (resolved relative to the SVG file) crisply; filters such as blur and
  nested `<svg>` viewports are not supported, so fake shadows with offset translucent shapes.
- **Screen recordings flash loading states.** Scan the source a second at a time
  (`ffmpeg -vf fps=1,...,tile=`) before choosing an in-point.
- `melt` writes progress and FFmpeg warnings to stderr; in PowerShell this shows as a
  `NativeCommandError` even when the render succeeded. Check the exit code and the output file.

### Other tools in the Shotcut folder

- `whisper-cli` — speech-to-text, useful for generating captions from narration.
- `glaxnimate` — vector animation editor for animated titles and logos (exports Lottie/video).
- `ffplay` — quick playback of a render.

### Verification and references

Run `python scripts/shotcut.test.py -v` from the repository root. The suite includes real
frame extraction when FFmpeg/ffprobe are installed; otherwise that integration test is skipped.
MLT render commands are checked with a test double and are not proof of renderer compatibility.

Authoritative references checked 2026-10-01:

- [MLT volume filter](https://www.mltframework.org/plugins/FilterVolume/) — `level` is an animated
  decibel value; the script's gain and fade values use that contract.
- [MLT avformat consumer](https://www.mltframework.org/plugins/ConsumerAvformat/) — output dimensions
  and numerator/denominator frame-rate settings used by previews. Validate codec support in the
  installed build before production use.
- [FFmpeg tile filter](https://ffmpeg.org/ffmpeg-filters.html#tile) — the contact-sheet grid combines
  sampled video frames. The synthetic-video test verifies the local FFmpeg build, not every version.

These are source-linked summaries, not archived manuals. Recheck the installed versions when
changing filters or render behavior.

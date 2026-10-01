#!/usr/bin/env python3
"""
Build, render and inspect Shotcut (MLT) projects from the command line. Python 3.9+, stdlib only.

Usage:
  python shotcut.py build  <spec.json> -o <project.mlt>
  python shotcut.py render <project.mlt> -o <video.mp4> [--preview]
  python shotcut.py frames <video> -o <sheet.png> [--count 12 | --at 1.5,4]

The global --shotcut-dir option defaults to SHOTCUT_DIR. That folder must contain melt
(or mlt-melt/melt-7), ffmpeg and ffprobe. Without a folder, tools are discovered on PATH.

build   Writes a project that melt renders and Shotcut opens and edits as usual. The spec format
        is documented in guides/shotcut-video.md. Media paths in the spec are relative to the
        spec file and are stored relative to the project file. Probes media with ffprobe.
render  Renders a project headless with melt. --preview renders at half size, fast and lossy.
frames  Writes a contact sheet of --count evenly spaced frames, or with --at one full-size PNG
        per timestamp, named <output-stem>-<seconds>s.png.
Successful outputs replace existing files; failed outputs leave them intact.
Exit codes: 0 success, 1 invalid input or tool failure, 2 command-line syntax errors.
"""

import argparse
import contextlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from fractions import Fraction

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".svg"}

VIDEO_DEFAULTS = {"width": 1920, "height": 1080, "fps": 30}

SCENE_KEYS = {"name", "color", "source", "in", "duration", "transition", "zoom", "focus", "crop", "frame"}
TITLE_KEYS = {
    "text", "image", "layer", "start", "duration", "font", "size", "weight", "italic", "color", "outline",
    "outline_color", "background", "padding", "box", "halign", "valign", "fade", "slide_from",
    "slide_distance", "slide_time",
}
AUDIO_KEYS = {"source", "start", "in", "duration", "gain_db", "fade_in", "fade_out"}
SPEC_KEYS = {"video", "backdrop", "scene_audio", "scenes", "titles", "audio"}

FINAL_ENCODING = {
    "vcodec": "libx264", "preset": "slow", "crf": "18", "pix_fmt": "yuv420p",
    "acodec": "aac", "ab": "256k", "movflags": "+faststart",
}
PREVIEW_ENCODING = {
    "vcodec": "libx264", "preset": "veryfast", "crf": "28", "pix_fmt": "yuv420p",
    "acodec": "aac", "ab": "128k",
}


class SpecError(Exception):
    pass


def main():
    args = parse_args()

    try:
        tools = find_tools(args.shotcut_dir)
        args.run(args, tools)
    except (SpecError, ToolError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    return 0


def parse_args():
    parser = argparse.ArgumentParser(description="Build, render and inspect Shotcut projects.")
    parser.add_argument("--shotcut-dir", default=os.environ.get("SHOTCUT_DIR"))
    commands = parser.add_subparsers(required=True, dest="command")

    build = commands.add_parser("build", help="spec JSON -> Shotcut .mlt project")
    build.add_argument("spec")
    build.add_argument("-o", "--output", required=True)
    build.set_defaults(run=run_build)

    render = commands.add_parser("render", help="render a .mlt project with melt")
    render.add_argument("project")
    render.add_argument("-o", "--output", required=True)
    render.add_argument("--preview", action="store_true", help="half size, fast, lossy")
    render.set_defaults(run=run_render)

    frames = commands.add_parser("frames", help="contact sheet or stills from a video")
    frames.add_argument("video")
    frames.add_argument("-o", "--output", required=True)
    frames.add_argument("--count", type=int, default=12)
    frames.add_argument("--at", help="comma-separated timestamps in seconds")
    frames.set_defaults(run=run_frames)

    return parser.parse_args()


# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

def run_build(args, tools):
    spec_path = os.path.abspath(args.spec)
    project_path = os.path.abspath(args.output)

    spec = load_spec(spec_path)
    builder = ProjectBuilder(spec, os.path.dirname(spec_path), os.path.dirname(project_path), tools)
    project = builder.build()
    reject_input_output(project_path, [spec_path, *builder.media_paths])

    ET.indent(project)
    with verified_output(project_path) as temporary:
        ET.ElementTree(project).write(temporary, encoding="utf-8", xml_declaration=True)

    print(f"wrote {project_path} ({builder.timeline_seconds():.2f}s)")


def run_render(args, tools):
    project_path = os.path.abspath(args.project)
    output_path = os.path.abspath(args.output)

    if not os.path.isfile(project_path):
        raise SpecError(f"project not found: {project_path}")

    try:
        project = ET.parse(project_path).getroot()
    except ET.ParseError as error:
        raise SpecError(f"cannot parse project {project_path}: {error}")
    media_root = os.path.join(os.path.dirname(project_path), project.get("root", ""))
    inputs = [project_path]
    for prop in project.iter("property"):
        if prop.get("name") in {"resource", "background"} and prop.text:
            path = prop.text.removeprefix("qimage:")
            inputs.append(os.path.join(media_root, path))
    reject_input_output(output_path, inputs)

    encoding = dict(PREVIEW_ENCODING if args.preview else FINAL_ENCODING)
    encoding["real_time"] = str(-min(os.cpu_count() or 1, 8))

    if args.preview:
        profile = read_profile(project_path)

        # yuv420p requires even dimensions, including after half-size rounding.
        encoding["width"] = str(max(2, int(profile["width"]) // 4 * 2))
        encoding["height"] = str(max(2, int(profile["height"]) // 4 * 2))
        encoding["frame_rate_num"] = profile["frame_rate_num"]
        encoding["frame_rate_den"] = profile["frame_rate_den"]
        encoding["progressive"] = profile.get("progressive", "1")

    with verified_output(output_path) as temporary:
        duration = render_with_fallback_codecs(tools, project_path, temporary, encoding)
    print(f"wrote {output_path} ({duration:.2f}s)")


def render_with_fallback_codecs(tools, project_path, output_path, encoding):
    failures = []
    melt_command = tools.melt_command()

    for vcodec in render_codecs(encoding):
        render_encoding = dict(encoding, vcodec=vcodec)
        if vcodec != "libx264":
            # CRF and preset are x264-specific; the other encoders use a bitrate.
            render_encoding.pop("preset", None)
            render_encoding.pop("crf", None)
            render_encoding["vb"] = "4M"
        consumer_args = [f"{key}={value}" for key, value in render_encoding.items()]
        command = [*melt_command, "-progress2", project_path, "-consumer", f"avformat:{output_path}"]

        try:
            run_tool(command + consumer_args, capture=False)
            duration = probe_duration(tools, output_path)
            require_video_stream(tools, output_path)
            if failures:
                print(f"render used fallback codec {vcodec}", file=sys.stderr)
            return duration
        except ToolError as error:
            failures.append(f"{vcodec}: {error}")
            print(f"render attempt with {vcodec} failed: {error}", file=sys.stderr)
            with contextlib.suppress(FileNotFoundError):
                os.remove(output_path)

    raise ToolError("render failed with all video codecs: " + "; ".join(failures))


def render_codecs(encoding):
    requested = encoding["vcodec"]
    fallbacks = ["libopenh264", "mpeg4"]
    return [requested, *(codec for codec in fallbacks if codec != requested)]


def read_profile(project_path):
    try:
        profile = ET.parse(project_path).getroot().find("profile")
    except ET.ParseError as error:
        raise SpecError(f"cannot parse project {project_path}: {error}")

    if profile is None:
        raise SpecError(f"project has no <profile>: {project_path}")

    for key in ("width", "height", "frame_rate_num", "frame_rate_den"):
        try:
            value = int(profile.get(key, ""))
        except ValueError:
            raise SpecError(f"project profile needs a positive integer {key}")
        if value <= 0:
            raise SpecError(f"project profile needs a positive integer {key}")

    return profile.attrib


def run_frames(args, tools):
    video_path = os.path.abspath(args.video)
    output_path = os.path.abspath(args.output)

    if not os.path.isfile(video_path):
        raise SpecError(f"video not found: {video_path}")

    if args.at is not None:
        write_stills(tools, video_path, output_path, args.at)
    else:
        write_contact_sheet(tools, video_path, output_path, args.count)


def write_stills(tools, video_path, output_path, timestamps):
    stem, extension = os.path.splitext(output_path)
    duration = probe_duration(tools, video_path)
    outputs = []

    for timestamp in timestamps.split(","):
        try:
            seconds = float(timestamp)
        except ValueError:
            raise SpecError("--at needs comma-separated nonnegative timestamps")
        if not math.isfinite(seconds) or not 0 <= seconds < duration:
            raise SpecError(f"--at timestamps must be within the video (0 <= time < {duration:g})")
        still_path = f"{stem}-{seconds:.15g}s{extension or '.png'}"
        reject_input_output(still_path, [video_path])
        outputs.append((seconds, still_path))
    if len({path for _, path in outputs}) != len(outputs):
        raise SpecError("--at timestamps produce duplicate output names")

    for seconds, still_path in outputs:
        with verified_output(still_path) as temporary:
            command = [tools.ffmpeg, "-v", "error", "-y", "-ss", str(seconds), "-i", video_path,
                       "-frames:v", "1", temporary]
            run_tool(command)
        print(f"wrote {still_path}")


def write_contact_sheet(tools, video_path, output_path, count):
    if count < 1:
        raise SpecError("--count must be at least 1")
    reject_input_output(output_path, [video_path])

    duration = probe_duration(tools, video_path)
    columns = min(count, 4)
    rows = math.ceil(count / columns)

    sheet_filter = f"fps={count}/{duration:.12g},scale=480:-2,tile={columns}x{rows}:padding=4"
    with verified_output(output_path) as temporary:
        command = [tools.ffmpeg, "-v", "error", "-y", "-i", video_path, "-vf", sheet_filter,
                   "-frames:v", "1", temporary]
        run_tool(command)
    print(f"wrote {output_path} ({count} frames over {duration:.2f}s, read left to right)")


# ---------------------------------------------------------------------------------------------
# Spec -> MLT
# ---------------------------------------------------------------------------------------------

def load_spec(spec_path):
    try:
        with open(spec_path, encoding="utf-8") as spec_file:
            spec = json.load(spec_file)
    except (OSError, json.JSONDecodeError) as error:
        raise SpecError(f"cannot read spec {spec_path}: {error}")

    validate_spec(spec)
    return spec


def check_keys(item, allowed, label):
    if not isinstance(item, dict):
        raise SpecError(f"{label} must be an object")

    unknown = sorted(set(item) - set(allowed))

    if unknown:
        raise SpecError(f"{label}: unknown key(s) {', '.join(unknown)}")


def validate_spec(spec):
    check_keys(spec, SPEC_KEYS, "spec")
    video = spec.get("video", {})
    check_keys(video, VIDEO_DEFAULTS, "video")
    dimensions = {**VIDEO_DEFAULTS, **video}
    for key in ("width", "height"):
        value = dimensions[key]
        if type(value) is not int or value < 2 or value % 2:
            raise SpecError(f"video.{key} must be a positive even integer")
    parse_fps(dimensions["fps"])
    if "scene_audio" in spec and type(spec["scene_audio"]) is not bool:
        raise SpecError("scene_audio must be true or false")
    if "backdrop" in spec:
        string(spec["backdrop"], "backdrop")

    for collection, keys in (("scenes", SCENE_KEYS), ("titles", TITLE_KEYS), ("audio", AUDIO_KEYS)):
        items = spec.get(collection, [])
        if not isinstance(items, list):
            raise SpecError(f"{collection} must be an array")
        if collection == "scenes" and not items:
            raise SpecError("spec needs at least one entry in 'scenes'")
        for index, item in enumerate(items):
            label = f"{collection}[{index}]"
            check_keys(item, keys, label)
            for key in ("source", "image", "text", "name", "font"):
                if key in item:
                    string(item[key], f"{label}.{key}")
            for key in ("color", "outline_color", "background"):
                if key in item and (not isinstance(item[key], str) or
                                  not re.fullmatch(r"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?", item[key])):
                    raise SpecError(f"{label}.{key} must be #rrggbb or #aarrggbb")
            for key in ("in", "start", "transition", "fade", "fade_in", "fade_out",
                        "slide_distance", "slide_time", "outline", "padding"):
                if key in item:
                    number(item[key], f"{label}.{key}", minimum=0)
            for key in ("duration", "size"):
                if key in item:
                    number(item[key], f"{label}.{key}", positive=True)
            if "gain_db" in item:
                number(item["gain_db"], f"{label}.gain_db")
            for key, length in (("zoom", 2), ("focus", 2), ("crop", 4), ("frame", 4), ("box", 4)):
                if key in item:
                    vector(item[key], length, f"{label}.{key}")
            if "zoom" in item:
                for scale in item["zoom"]:
                    number(scale, f"{label}.zoom scale", positive=True)
            for key in ("crop", "frame", "box"):
                if key in item:
                    for size in item[key][2:]:
                        number(size, f"{label}.{key} size", positive=True)
            if "crop" in item:
                x, y, width, height = item["crop"]
                if x < 0 or y < 0 or x + width > dimensions["width"] or y + height > dimensions["height"]:
                    raise SpecError(f"{label}.crop must fit inside the project frame")
            for key, choices in (("halign", ("left", "center", "right")),
                                 ("valign", ("top", "middle", "bottom")),
                                 ("slide_from", ("left", "right", "top", "bottom"))):
                if key in item and item[key] not in choices:
                    raise SpecError(f"{label}.{key} must be one of {', '.join(choices)}")
            if "layer" in item and type(item["layer"]) is not int:
                raise SpecError(f"{label}.layer must be an integer")
            if "italic" in item and type(item["italic"]) is not bool:
                raise SpecError(f"{label}.italic must be true or false")
            if "weight" in item and (type(item["weight"]) is not int or not 100 <= item["weight"] <= 900):
                raise SpecError(f"{label}.weight must be an integer from 100 to 900")
            if collection == "scenes" and ("color" in item) == ("source" in item):
                raise SpecError(f"{label} needs exactly one of color or source")
            if collection == "titles" and ("text" in item) == ("image" in item):
                raise SpecError(f"{label} needs exactly one of text or image")


def parse_fps(value):
    try:
        if isinstance(value, bool):
            raise ValueError()
        rate = Fraction(str(value))
        if rate <= 0 or not math.isfinite(float(rate)):
            raise ValueError()
        return rate
    except (ValueError, ZeroDivisionError, OverflowError):
        raise SpecError("video.fps must be positive, e.g. 30, 29.97 or '30000/1001'")


def number(value, label, minimum=None, positive=False):
    try:
        valid = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid or (minimum is not None and value < minimum) or (positive and value <= 0):
        constraint = "positive" if positive else f">= {minimum}" if minimum is not None else "numeric"
        raise SpecError(f"{label} must be finite and {constraint}")
    return value


def string(value, label):
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise SpecError(f"{label} must be a nonempty string without NUL characters")


def vector(value, length, label):
    if not isinstance(value, list) or len(value) != length:
        raise SpecError(f"{label} must contain {length} numbers")
    for coordinate in value:
        number(coordinate, label)


def reject_input_output(output_path, input_paths):
    destination = os.path.normcase(os.path.realpath(output_path))
    for path in input_paths:
        same_path = destination == os.path.normcase(os.path.realpath(path))
        same_file = os.path.exists(output_path) and os.path.exists(path) and os.path.samefile(output_path, path)
        if same_path or same_file:
            raise SpecError("output must not overwrite an input file")


@contextmanager
def verified_output(output_path):
    # A separate destination prevents failed tools and empty seeks from accepting stale output.
    with tempfile.TemporaryDirectory(prefix=".shotcut-", dir=os.path.dirname(os.path.abspath(output_path))) as directory:
        temporary = os.path.join(directory, os.path.basename(output_path))
        yield temporary
        if not os.path.isfile(temporary) or os.path.getsize(temporary) == 0:
            raise ToolError(f"command completed without producing output: {output_path}")
        os.replace(temporary, output_path)


class ProjectBuilder:
    def __init__(self, spec, spec_dir, project_dir, tools):
        validate_spec(spec)
        self.spec = spec
        self.spec_dir = spec_dir
        self.project_dir = project_dir
        self.tools = tools
        self.media_paths = set()

        video = {**VIDEO_DEFAULTS, **spec.get("video", {})}
        self.width = int(video["width"])
        self.height = int(video["height"])
        self.frame_rate = parse_fps(video["fps"])
        self.fps = float(self.frame_rate)

        self.root = None
        self.next_id = 0
        self.timeline_frames = 0

    def build(self):
        self.root = ET.Element("mlt", {
            "LC_NUMERIC": "C", "version": "7.33.0", "producer": "main_bin",
            "root": self.project_dir.replace("\\", "/"),
        })
        self.add_profile()

        main_bin = ET.SubElement(self.root, "playlist", {"id": "main_bin"})
        add_property(main_bin, "xml_retain", "1")

        scene_track = self.build_scene_track()
        title_tracks = self.build_title_tracks()
        audio_tracks = self.build_audio_tracks()
        background = self.build_background()

        tractor = ET.SubElement(self.root, "tractor", {
            "id": "tractor0", "in": "0", "out": str(self.timeline_frames - 1),
        })
        add_property(tractor, "shotcut", "1")
        add_property(tractor, "shotcut:projectAudioChannels", "2")

        ET.SubElement(tractor, "track", {"producer": background})
        scene_attributes = {"producer": scene_track}

        if self.spec.get("scene_audio", True) is False:
            scene_attributes["hide"] = "audio"

        ET.SubElement(tractor, "track", scene_attributes)

        for track in title_tracks:
            ET.SubElement(tractor, "track", {"producer": track})
        for track in audio_tracks:
            ET.SubElement(tractor, "track", {"producer": track, "hide": "video"})

        video_track_count = 1 + len(title_tracks)
        track_count = video_track_count + len(audio_tracks)

        for track_index in range(1, track_count + 1):
            self.add_track_transitions(tractor, track_index, track_index <= video_track_count)

        return self.root

    def timeline_seconds(self):
        return self.timeline_frames / self.fps

    def add_profile(self):
        divisor = math.gcd(self.width, self.height)

        ET.SubElement(self.root, "profile", {
            "description": f"{self.width}x{self.height} {self.fps} fps",
            "width": str(self.width), "height": str(self.height), "progressive": "1",
            "sample_aspect_num": "1", "sample_aspect_den": "1",
            "display_aspect_num": str(self.width // divisor),
            "display_aspect_den": str(self.height // divisor),
            "frame_rate_num": str(self.frame_rate.numerator),
            "frame_rate_den": str(self.frame_rate.denominator), "colorspace": "709",
        })

    # Scenes ------------------------------------------------------------------------------------

    def build_scene_track(self):
        scenes = [self.resolve_scene(index, scene) for index, scene in enumerate(self.spec["scenes"])]

        for index, scene in enumerate(scenes):
            incoming = scene["transition"]
            outgoing = scenes[index + 1]["transition"] if index + 1 < len(scenes) else 0

            if index == 0 and incoming:
                raise SpecError("scenes[0]: the first scene cannot have a transition")

            if incoming + outgoing >= scene["length"]:
                raise SpecError(f"scenes[{index}]: transitions overlap; lengthen the scene "
                                "or shorten its transitions")

        entries = []

        for index, scene in enumerate(scenes):
            incoming = scene["transition"]
            outgoing = scenes[index + 1]["transition"] if index + 1 < len(scenes) else 0

            solo_in = scene["in"] + incoming
            solo_out = scene["in"] + scene["length"] - outgoing - 1

            entries.append(("entry", scene["producer"], solo_in, solo_out))

            if outgoing:
                crossfade = self.build_crossfade(scene, scenes[index + 1], outgoing)
                entries.append(("entry", crossfade, 0, outgoing - 1))

        self.timeline_frames = sum(scene["length"] - scene["transition"] for scene in scenes)

        return self.add_playlist({"shotcut:video": "1", "shotcut:name": "V1"}, entries)

    def resolve_scene(self, index, scene):
        label = f"scenes[{index}]"
        transition = self.frames(scene.get("transition", 0))

        if "color" in scene:
            length = self.frames(require(scene, "duration", label))
            producer = self.add_color_producer(scene["color"], length, scene.get("name"))
            source_in = 0
        elif "source" in scene:
            path = self.media_path(scene["source"], label)
            source_in = self.frames(scene.get("in", 0))
            length, producer = self.add_visual_producer(path, source_in, scene.get("duration"), label)
        else:
            raise SpecError(f"{label}: needs 'color' or 'source'")

        if length < 1:
            raise SpecError(f"{label}: duration must be positive")

        if "crop" in scene:
            self.add_crop(producer, scene["crop"], source_in, length, label)

        if "frame" in scene:
            self.add_frame(producer, scene["frame"], scene.get("zoom", [1, 1]), source_in, length, label)
        elif "zoom" in scene:
            focus = scene.get("focus", [self.width / 2, self.height / 2])
            self.add_zoom(producer, scene["zoom"], focus, source_in, length, label)

        return {"producer": producer, "in": source_in, "length": length, "transition": transition}

    def add_color_producer(self, color, length, name):
        producer = self.new_element("producer")
        add_property(producer, "length", str(length))
        add_property(producer, "mlt_service", "color")
        add_property(producer, "resource", color)
        add_property(producer, "mlt_image_format", "rgba")
        add_property(producer, "shotcut:caption", name or color)

        return producer.get("id")

    def add_visual_producer(self, path, source_in, duration, label):
        is_image = os.path.splitext(path)[1].lower() in IMAGE_EXTENSIONS
        producer = self.new_element("producer")

        if is_image:
            length = self.frames(require({"duration": duration}, "duration", label))
            add_property(producer, "length", str(source_in + length))
            add_property(producer, "mlt_service", "qimage")
            add_property(producer, "ttl", "1")
        else:
            available = self.frames(probe_duration(self.tools, path)) - source_in
            length = self.frames(duration) if duration is not None else available

            if length > available:
                raise SpecError(f"{label}: wants {length / self.fps:.2f}s but the source has "
                                f"{available / self.fps:.2f}s after 'in'")

            add_property(producer, "length", str(source_in + available))
            add_property(producer, "mlt_service", "avformat-novalidate")

        add_property(producer, "resource", self.project_relative(path))
        add_property(producer, "shotcut:caption", os.path.basename(path))

        return length, producer.get("id")

    def add_zoom(self, producer_id, zoom, focus, source_in, length, label):
        if not (isinstance(zoom, list) and len(zoom) == 2):
            raise SpecError(f"{label}: 'zoom' must be [from, to], e.g. [1.0, 1.15]")

        if not (isinstance(focus, list) and len(focus) == 2):
            raise SpecError(f"{label}: 'focus' must be [x, y] in project pixels")

        start_rect = self.zoom_rect(zoom[0], focus)
        end_rect = self.zoom_rect(zoom[1], focus)

        producer = self.find_by_id(producer_id)
        zoom_filter = ET.SubElement(producer, "filter", {
            "in": str(source_in), "out": str(source_in + length - 1),
        })
        add_property(zoom_filter, "background", "color:#00000000")
        add_property(zoom_filter, "mlt_service", "affine")
        add_property(zoom_filter, "shotcut:filter", "affineSizePosition")
        add_property(zoom_filter, "transition.fill", "1")
        add_property(zoom_filter, "transition.distort", "0")
        add_property(zoom_filter, "transition.rect", f"0={start_rect};{length - 1}={end_rect}")
        add_property(zoom_filter, "transition.valign", "middle")
        add_property(zoom_filter, "transition.halign", "center")
        add_property(zoom_filter, "transition.threads", "0")

    def add_crop(self, producer_id, crop, source_in, length, label):
        if not (isinstance(crop, list) and len(crop) == 4):
            raise SpecError(f"{label}: 'crop' must be [x, y, width, height] in project pixels")

        x, y, width, height = crop

        producer = self.find_by_id(producer_id)
        crop_filter = ET.SubElement(producer, "filter", {
            "in": str(source_in), "out": str(source_in + length - 1),
        })
        add_property(crop_filter, "left", f"{x:g}")
        add_property(crop_filter, "top", f"{y:g}")
        add_property(crop_filter, "right", f"{self.width - x - width:g}")
        add_property(crop_filter, "bottom", f"{self.height - y - height:g}")
        add_property(crop_filter, "center", "0")
        add_property(crop_filter, "use_profile", "1")
        add_property(crop_filter, "mlt_service", "crop")
        add_property(crop_filter, "shotcut:filter", "crop")

    def add_frame(self, producer_id, frame, zoom, source_in, length, label):
        if not (isinstance(frame, list) and len(frame) == 4):
            raise SpecError(f"{label}: 'frame' must be [x, y, width, height] in pixels")

        start_rect = scaled_box(frame, zoom[0])
        end_rect = scaled_box(frame, zoom[1])

        producer = self.find_by_id(producer_id)
        frame_filter = ET.SubElement(producer, "filter", {
            "in": str(source_in), "out": str(source_in + length - 1),
        })
        add_property(frame_filter, "background", self.frame_background())
        add_property(frame_filter, "mlt_service", "affine")
        add_property(frame_filter, "shotcut:filter", "affineSizePosition")
        add_property(frame_filter, "transition.fill", "1")
        add_property(frame_filter, "transition.distort", "0")
        add_property(frame_filter, "transition.rect", f"0={start_rect};{length - 1}={end_rect}")
        add_property(frame_filter, "transition.valign", "middle")
        add_property(frame_filter, "transition.halign", "center")
        add_property(frame_filter, "transition.threads", "0")

    def frame_background(self):
        if "backdrop" not in self.spec:
            return "color:#00000000"

        path = self.media_path(self.spec["backdrop"], "backdrop")

        return "qimage:" + path.replace("\\", "/")

    def build_crossfade(self, outgoing_scene, incoming_scene, length):
        outgoing_end = outgoing_scene["in"] + outgoing_scene["length"] - 1

        tractor = self.new_element("tractor", {"in": "0", "out": str(length - 1)})
        add_property(tractor, "shotcut:transition", "lumaMix")

        ET.SubElement(tractor, "track", {
            "producer": outgoing_scene["producer"],
            "in": str(outgoing_end - length + 1), "out": str(outgoing_end),
        })
        ET.SubElement(tractor, "track", {
            "producer": incoming_scene["producer"],
            "in": str(incoming_scene["in"]), "out": str(incoming_scene["in"] + length - 1),
        })

        luma = ET.SubElement(tractor, "transition", {"out": str(length - 1)})
        add_property(luma, "a_track", "0")
        add_property(luma, "b_track", "1")
        add_property(luma, "factory", "loader")
        add_property(luma, "mlt_service", "luma")

        mix = ET.SubElement(tractor, "transition", {"out": str(length - 1)})
        add_property(mix, "a_track", "0")
        add_property(mix, "b_track", "1")
        add_property(mix, "start", "-1")
        add_property(mix, "accepts_blanks", "1")
        add_property(mix, "mlt_service", "mix")

        return tractor.get("id")

    # Titles ------------------------------------------------------------------------------------

    def build_title_tracks(self):
        titles = []

        for index, title in enumerate(self.spec.get("titles", [])):
            label = f"titles[{index}]"
            start = self.frames(require(title, "start", label))
            length = self.frames(require(title, "duration", label))

            if length < 2:
                raise SpecError(f"{label}: duration is too short")

            titles.append({"spec": title, "label": label, "start": start, "length": length})

        tracks = []

        layers = sorted({title["spec"].get("layer", 0) for title in titles})
        title_tracks = []

        for layer in layers:
            layer_titles = [title for title in titles if title["spec"].get("layer", 0) == layer]
            title_tracks.extend(assign_tracks(layer_titles))

        for track_number, track_titles in enumerate(title_tracks, start=2):
            entries = []
            cursor = 0

            for title in track_titles:
                if title["start"] > cursor:
                    entries.append(("blank", title["start"] - cursor))

                producer = self.add_title_producer(title)
                entries.append(("entry", producer, 0, title["length"] - 1))

                cursor = title["start"] + title["length"]
                self.timeline_frames = max(self.timeline_frames, cursor)

            properties = {"shotcut:video": "1", "shotcut:name": f"V{track_number}"}
            tracks.append(self.add_playlist(properties, entries))

        return tracks

    def add_title_producer(self, title):
        if "image" in title["spec"]:
            return self.add_image_overlay_producer(title)

        spec = title["spec"]
        length = title["length"]
        text = require(spec, "text", title["label"])

        producer = self.new_element("producer")
        add_property(producer, "length", str(length))
        add_property(producer, "mlt_service", "color")
        add_property(producer, "resource", "#00000000")
        add_property(producer, "mlt_image_format", "rgba")
        add_property(producer, "shotcut:caption", text.splitlines()[0])

        text_filter = ET.SubElement(producer, "filter", {"in": "0", "out": str(length - 1)})
        add_property(text_filter, "argument", text)
        add_property(text_filter, "geometry", self.title_geometry(spec, length, title["label"]))
        add_property(text_filter, "family", spec.get("font", "Sans"))
        add_property(text_filter, "size", str(spec.get("size", 80)))
        add_property(text_filter, "weight", str(spec.get("weight", 400)))
        add_property(text_filter, "style", "italic" if spec.get("italic") else "normal")
        add_property(text_filter, "fgcolour", spec.get("color", "#ffffff"))
        add_property(text_filter, "olcolour", spec.get("outline_color", "#000000"))
        add_property(text_filter, "outline", str(spec.get("outline", 0)))
        add_property(text_filter, "bgcolour", spec.get("background", "#00000000"))
        add_property(text_filter, "pad", str(spec.get("padding", 0)))
        add_property(text_filter, "halign", spec.get("halign", "center"))
        add_property(text_filter, "valign", spec.get("valign", "middle"))
        add_property(text_filter, "opacity", self.title_opacity(spec, length, title["label"]))
        add_property(text_filter, "mlt_service", "dynamictext")
        add_property(text_filter, "shotcut:filter", "dynamicText")
        add_property(text_filter, "shotcut:usePointSize", "0")

        return producer.get("id")

    def add_image_overlay_producer(self, title):
        spec = title["spec"]
        length = title["length"]
        label = title["label"]
        path = self.media_path(spec["image"], label)

        producer = self.new_element("producer")
        add_property(producer, "length", str(length))
        add_property(producer, "mlt_service", "qimage")
        add_property(producer, "resource", self.project_relative(path))
        add_property(producer, "ttl", "1")
        add_property(producer, "shotcut:caption", os.path.basename(path))

        opacity_filter = ET.SubElement(producer, "filter", {"in": "0", "out": str(length - 1)})
        add_property(opacity_filter, "level", "1")
        add_property(opacity_filter, "alpha", self.title_opacity(spec, length, label))
        add_property(opacity_filter, "mlt_service", "brightness")
        add_property(opacity_filter, "shotcut:filter", "brightnessOpacity")

        position_filter = ET.SubElement(producer, "filter", {"in": "0", "out": str(length - 1)})
        add_property(position_filter, "background", "color:#00000000")
        add_property(position_filter, "mlt_service", "affine")
        add_property(position_filter, "shotcut:filter", "affineSizePosition")
        add_property(position_filter, "transition.fill", "1")
        add_property(position_filter, "transition.distort", "0")
        add_property(position_filter, "transition.rect", self.title_geometry(spec, length, label))
        add_property(position_filter, "transition.valign", spec.get("valign", "middle"))
        add_property(position_filter, "transition.halign", spec.get("halign", "center"))
        add_property(position_filter, "transition.threads", "0")

        return producer.get("id")

    def title_geometry(self, spec, length, label):
        box = spec.get("box", [0, 0, self.width, self.height])

        if not (isinstance(box, list) and len(box) == 4):
            raise SpecError(f"{label}: 'box' must be [x, y, width, height] in pixels")

        x, y, width, height = box
        resting = f"{x} {y} {width} {height} 1"
        slide_from = spec.get("slide_from")

        if slide_from is None:
            return resting

        offsets = {"left": (-1, 0), "right": (1, 0), "top": (0, -1), "bottom": (0, 1)}

        if slide_from not in offsets:
            raise SpecError(f"{label}: 'slide_from' must be one of {', '.join(offsets)}")

        distance = spec.get("slide_distance", 120)
        slide_frames = min(self.frames(spec.get("slide_time", 0.6)), length - 1)
        dx, dy = offsets[slide_from]

        start = f"{x + dx * distance} {y + dy * distance} {width} {height} 1"

        return f"0~={start};{slide_frames}~={resting}"

    def title_opacity(self, spec, length, label):
        fade = self.frames(spec.get("fade", 0.3))

        if fade == 0:
            return "1"

        if 2 * fade > length:
            raise SpecError(f"{label}: 'fade' is longer than half the title's duration")

        return f"0~=0;{fade - 1}~=1;{length - fade}~=1;{length - 1}~=0"

    # Audio -------------------------------------------------------------------------------------

    def build_audio_tracks(self):
        clips = []

        for index, audio in enumerate(self.spec.get("audio", [])):
            label = f"audio[{index}]"
            path = self.media_path(require(audio, "source", label), label)
            start = self.frames(audio.get("start", 0))
            source_in = self.frames(audio.get("in", 0))

            available = self.frames(probe_duration(self.tools, path)) - source_in
            wanted = self.frames(audio["duration"]) if "duration" in audio else self.timeline_frames - start
            length = min(wanted, available)

            if length < 1:
                raise SpecError(f"{label}: nothing left to play; check 'start', 'in' and 'duration'")

            clips.append({"spec": audio, "label": label, "path": path, "start": start,
                          "in": source_in, "length": length, "available": available})

        tracks = []

        for track_number, track_clips in enumerate(assign_tracks(clips), start=1):
            entries = []
            cursor = 0

            for clip in track_clips:
                if clip["start"] > cursor:
                    entries.append(("blank", clip["start"] - cursor))

                producer = self.add_audio_producer(clip)
                entries.append(("entry", producer, clip["in"], clip["in"] + clip["length"] - 1))

                cursor = clip["start"] + clip["length"]
                self.timeline_frames = max(self.timeline_frames, cursor)

            properties = {"shotcut:audio": "1", "shotcut:name": f"A{track_number}"}
            tracks.append(self.add_playlist(properties, entries))

        return tracks

    def add_audio_producer(self, clip):
        spec = clip["spec"]
        clip_in = clip["in"]
        clip_out = clip["in"] + clip["length"] - 1

        producer = self.new_element("producer")
        add_property(producer, "length", str(clip["in"] + clip["available"]))
        add_property(producer, "mlt_service", "avformat-novalidate")
        add_property(producer, "resource", self.project_relative(clip["path"]))
        add_property(producer, "shotcut:caption", os.path.basename(clip["path"]))

        gain = spec.get("gain_db", 0)

        if gain:
            self.add_volume_filter(producer, "audioGain", clip_in, clip_out, str(gain))

        fade_in = min(self.frames(spec.get("fade_in", 0)), clip["length"])
        fade_out = min(self.frames(spec.get("fade_out", 0)), clip["length"])

        if fade_in:
            self.add_volume_filter(producer, "fadeInVolume", clip_in, clip_in + fade_in - 1,
                                   f"0=-60;{fade_in - 1}=0")

        if fade_out:
            self.add_volume_filter(producer, "fadeOutVolume", clip_out - fade_out + 1, clip_out,
                                   f"0=0;{fade_out - 1}=-60")

        return producer.get("id")

    def add_volume_filter(self, producer, shotcut_name, filter_in, filter_out, level):
        volume = ET.SubElement(producer, "filter", {"in": str(filter_in), "out": str(filter_out)})
        add_property(volume, "window", "75")
        add_property(volume, "max_gain", "20dB")
        add_property(volume, "level", level)
        add_property(volume, "mlt_service", "volume")
        add_property(volume, "shotcut:filter", shotcut_name)

    # Tractor -----------------------------------------------------------------------------------

    def build_background(self):
        producer = self.new_element("producer", {"in": "0", "out": str(self.timeline_frames - 1)})
        add_property(producer, "length", str(self.timeline_frames))

        if "backdrop" in self.spec:
            path = self.media_path(self.spec["backdrop"], "backdrop")
            add_property(producer, "mlt_service", "qimage")
            add_property(producer, "resource", self.project_relative(path))
            add_property(producer, "ttl", "1")
        else:
            add_property(producer, "mlt_service", "color")
            add_property(producer, "resource", "0")
            add_property(producer, "mlt_image_format", "rgba")

        add_property(producer, "set.test_audio", "0")

        entries = [("entry", producer.get("id"), 0, self.timeline_frames - 1)]

        return self.add_playlist({}, entries, "background")

    def add_track_transitions(self, tractor, track_index, is_video):
        mix = ET.SubElement(tractor, "transition")
        add_property(mix, "a_track", "0")
        add_property(mix, "b_track", str(track_index))
        add_property(mix, "mlt_service", "mix")
        add_property(mix, "always_active", "1")
        add_property(mix, "sum", "1")

        if not is_video:
            return

        blend = ET.SubElement(tractor, "transition")
        blend_target = "0" if track_index == 1 or "backdrop" in self.spec else "1"
        add_property(blend, "a_track", blend_target)
        add_property(blend, "b_track", str(track_index))
        add_property(blend, "version", "0.9")
        add_property(blend, "mlt_service", "frei0r.cairoblend")
        add_property(blend, "threads", "0")
        covers_background = track_index == 1 and "backdrop" not in self.spec
        add_property(blend, "disable", "1" if covers_background else "0")

    # Helpers -----------------------------------------------------------------------------------

    def add_playlist(self, properties, entries, playlist_id=None):
        attributes = {"id": playlist_id} if playlist_id else None
        playlist = self.new_element("playlist", attributes)

        for name, value in properties.items():
            add_property(playlist, name, value)

        for entry in entries:
            if entry[0] == "blank":
                ET.SubElement(playlist, "blank", {"length": str(entry[1])})
            else:
                _, producer_id, entry_in, entry_out = entry
                ET.SubElement(playlist, "entry", {
                    "producer": producer_id, "in": str(entry_in), "out": str(entry_out),
                })

        return playlist.get("id")

    def new_element(self, tag, attributes=None):
        element_id = attributes.pop("id") if attributes and "id" in attributes else None

        if element_id is None:
            element_id = f"{tag}{self.next_id}"
            self.next_id += 1

        return ET.SubElement(self.root, tag, {"id": element_id, **(attributes or {})})

    def find_by_id(self, element_id):
        return self.root.find(f"*[@id='{element_id}']")

    def frames(self, seconds):
        return round(number(seconds, "time", minimum=0) * self.fps)

    def zoom_rect(self, scale, focus):
        scale = float(scale)
        width = self.width * scale
        height = self.height * scale

        x = self.width / 2 - focus[0] * scale
        y = self.height / 2 - focus[1] * scale

        x = min(0, max(self.width - width, x))
        y = min(0, max(self.height - height, y))

        return f"{x:g} {y:g} {width:g} {height:g} 1"

    def media_path(self, source, label):
        path = os.path.normpath(os.path.join(self.spec_dir, source))

        if not os.path.isfile(path):
            raise SpecError(f"{label}: media not found: {path}")

        self.media_paths.add(path)
        return path

    def project_relative(self, path):
        try:
            relative = os.path.relpath(path, self.project_dir)
        except ValueError:
            relative = path

        return relative.replace("\\", "/")


def assign_tracks(items):
    """Place items on the fewest tracks so none overlap; returns a list of tracks."""
    tracks = []

    for item in sorted(items, key=lambda candidate: candidate["start"]):
        for track in tracks:
            last = track[-1]

            if last["start"] + last["length"] <= item["start"]:
                track.append(item)
                break
        else:
            tracks.append([item])

    return tracks


def add_property(element, name, value):
    ET.SubElement(element, "property", {"name": name}).text = value


def scaled_box(box, scale):
    x, y, width, height = box
    scaled_width = width * float(scale)
    scaled_height = height * float(scale)

    return f"{x + (width - scaled_width) / 2:g} {y + (height - scaled_height) / 2:g} {scaled_width:g} {scaled_height:g} 1"


def require(item, key, label):
    if item.get(key) is None:
        raise SpecError(f"{label}: missing '{key}'")

    return item[key]


# ---------------------------------------------------------------------------------------------
# External tools
# ---------------------------------------------------------------------------------------------

class ToolError(Exception):
    pass


class Tools:
    def __init__(self, melt, ffmpeg, ffprobe):
        self.melt = melt
        self.ffmpeg = ffmpeg
        self.ffprobe = ffprobe

    def melt_command(self):
        command = [self.melt]
        if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or
                                                     os.environ.get("WAYLAND_DISPLAY")):
            xvfb = shutil.which("xvfb-run")
            if xvfb is None:
                raise ToolError("headless Linux rendering needs xvfb-run (or an X11/Wayland display)")
            command = [xvfb, "-a", *command]
        return command


def find_tools(shotcut_dir):
    found = {}

    for name in ("melt", "ffmpeg", "ffprobe"):
        names = ("melt", "mlt-melt", "melt-7") if name == "melt" else (name,)
        if shotcut_dir:
            candidates = [
                os.path.join(folder, executable + suffix)
                for folder in (shotcut_dir, os.path.join(shotcut_dir, "bin"))
                for executable in names
                for suffix in ("", ".exe")
            ]
        else:
            candidates = names
        path = next((path for candidate in candidates if (path := shutil.which(candidate))), None)

        if path is None:
            raise ToolError(f"{name} not found in {shotcut_dir or 'PATH'}")

        found[name] = path

    return Tools(found["melt"], found["ffmpeg"], found["ffprobe"])


def probe_duration(tools, path):
    command = [tools.ffprobe, "-v", "error", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", path]
    output = run_tool(command).strip()

    try:
        duration = float(output)
    except ValueError:
        raise ToolError(f"ffprobe could not read a duration from {path}")
    if not math.isfinite(duration) or duration <= 0:
        raise ToolError(f"ffprobe returned no positive finite duration for {path}")
    return duration


def require_video_stream(tools, path):
    command = [tools.ffprobe, "-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=codec_type", "-of", "csv=p=0", path]
    if run_tool(command).strip() != "video":
        raise ToolError(f"ffprobe found no video stream in {path}")


def run_tool(command, capture=True):
    try:
        result = subprocess.run(command, capture_output=capture, text=True)
    except OSError as error:
        raise ToolError(f"cannot run {os.path.basename(command[0])}: {error}")

    if result.returncode != 0:
        detail = (result.stderr or "").strip()[-2000:] if capture else ""
        raise ToolError(f"{os.path.basename(command[0])} failed ({result.returncode}) {detail}")

    return result.stdout if capture else ""


if __name__ == "__main__":
    sys.exit(main())

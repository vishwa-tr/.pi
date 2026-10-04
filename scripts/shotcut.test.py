import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "agent/library/scripts/shotcut/shotcut.py"
MODULE = importlib.util.spec_from_file_location("shotcut", SOURCE)
shotcut = importlib.util.module_from_spec(MODULE)
MODULE.loader.exec_module(shotcut)


class ShotcutTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="shotcut-test-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.tools = shotcut.Tools("melt", "ffmpeg", "ffprobe")
        display = patch.dict(shotcut.os.environ, {"DISPLAY": ":test"})
        display.start()
        self.addCleanup(display.stop)

    def builder(self, spec):
        return shotcut.ProjectBuilder(spec, str(self.directory), str(self.directory), self.tools)

    def spec(self):
        return {"scenes": [{"color": "#123456", "duration": 2}]}

    def test_find_tools_accepts_linux_melt_names(self):
        for directory in (None, str(self.directory), str(self.directory / "portable")):
            for name in ("melt", "mlt-melt", "melt-7"):
                with self.subTest(directory=directory, name=name):
                    folder = Path(directory) / "bin" if directory else Path("/usr/bin")
                    available = {str(folder / tool) for tool in (name, "ffmpeg", "ffprobe")}

                    def which(candidate):
                        path = str(folder / candidate) if not directory else candidate
                        return path if path in available else None

                    with patch.object(shotcut.shutil, "which", side_effect=which):
                        tools = shotcut.find_tools(directory)
                    self.assertEqual(tools.melt, str(folder / name))
                    self.assertEqual(tools.ffprobe, str(folder / "ffprobe"))

    def test_explicit_tool_directory_does_not_fall_back_to_path(self):
        with patch.object(shotcut.shutil, "which", return_value=None), \
             self.assertRaisesRegex(shotcut.ToolError, "melt not found"):
            shotcut.find_tools(str(self.directory))

    def test_linux_headless_render_uses_xvfb(self):
        with patch.object(shotcut.sys, "platform", "linux"), \
             patch.dict(shotcut.os.environ, {}, clear=True), \
             patch.object(shotcut.shutil, "which", return_value="/usr/bin/xvfb-run"):
            self.assertEqual(self.tools.melt_command(), ["/usr/bin/xvfb-run", "-a", "melt"])
        with patch.object(shotcut.sys, "platform", "linux"), \
             patch.dict(shotcut.os.environ, {}, clear=True), \
             patch.object(shotcut.shutil, "which", return_value=None), \
             self.assertRaisesRegex(shotcut.ToolError, "needs xvfb-run"):
            self.tools.melt_command()

    def test_existing_display_and_non_linux_render_remain_unwrapped(self):
        for environment in ({"DISPLAY": ":1"}, {"WAYLAND_DISPLAY": "wayland-0"}):
            with patch.object(shotcut.sys, "platform", "linux"), \
                 patch.dict(shotcut.os.environ, environment, clear=True):
                self.assertEqual(self.tools.melt_command(), ["melt"])
        with patch.object(shotcut.sys, "platform", "win32"), \
             patch.dict(shotcut.os.environ, {}, clear=True):
            self.assertEqual(self.tools.melt_command(), ["melt"])

    def test_fractional_and_rational_frame_rates(self):
        for fps, numerator, denominator in ((29.97, "2997", "100"), ("30000/1001", "30000", "1001")):
            with self.subTest(fps=fps):
                spec = self.spec()
                spec["video"] = {"fps": fps}
                builder = self.builder(spec)
                profile = builder.build().find("profile")
                self.assertEqual(profile.get("frame_rate_num"), numerator)
                self.assertEqual(profile.get("frame_rate_den"), denominator)
                self.assertEqual(builder.timeline_frames, 60)

    def test_invalid_specs_raise_actionable_errors(self):
        cases = [
            None, {"scenes": {}}, {"scenes": []},
            {**self.spec(), "video": None},
            {**self.spec(), "video": {"fpps": 30}},
            {**self.spec(), "video": {"fps": 0}},
            {**self.spec(), "video": {"fps": "NaN"}},
            {**self.spec(), "video": {"width": 1919}},
            {**self.spec(), "titles": None},
            {**self.spec(), "scene_audio": "false"},
            {"scenes": [{"color": "#000000", "source": "clip.mp4", "duration": 1}]},
            {"scenes": [{"color": "#000000", "duration": 1, "transition": -1}]},
            {"scenes": [{"color": "#000000", "duration": float("inf")}]},
            {"scenes": [{"color": "#000000", "duration": True}]},
            {"scenes": [{"color": "#000000", "duration": 1, "frame": [0, 0, 30, 30], "zoom": [1]}]},
            {**self.spec(), "titles": [{"text": "", "start": 0, "duration": 1}]},
            {**self.spec(), "titles": [{"text": "hello", "start": -1, "duration": 1}]},
        ]
        for spec in cases:
            with self.subTest(spec=spec), self.assertRaises(shotcut.SpecError):
                self.builder(spec).build()

    def test_crossfade_duration_and_reference_order(self):
        spec = {"scenes": [{"color": "#000000", "duration": 2},
                           {"color": "#ffffff", "duration": 3, "transition": 0.5}]}
        builder = self.builder(spec)
        project = builder.build()
        self.assertEqual(builder.timeline_frames, 135)
        seen = set()
        for element in project:
            for reference in element.iter():
                if "producer" in reference.attrib:
                    self.assertIn(reference.get("producer"), seen)
            if element.get("id"):
                self.assertNotIn(element.get("id"), seen)
                seen.add(element.get("id"))

    def test_audio_tracks_hide_video_and_extend_explicit_duration(self):
        (self.directory / "source.mp4").write_bytes(b"fixture")
        spec = self.spec()
        spec["audio"] = [{"source": "source.mp4", "duration": 4, "gain_db": -6}]
        with patch.object(shotcut, "probe_duration", return_value=10):
            builder = self.builder(spec)
            project = builder.build()
        self.assertEqual(builder.timeline_frames, 120)
        audio = next(p for p in project.findall("playlist")
                     if p.find("property[@name='shotcut:audio']") is not None)
        track = project.find(f"tractor[@id='tractor0']/track[@producer='{audio.get('id')}']")
        self.assertEqual(track.get("hide"), "video")

    def test_build_rejects_overwriting_the_spec(self):
        path = self.directory / "spec.json"
        original = json.dumps(self.spec())
        path.write_text(original)
        args = Namespace(spec=str(path), output=str(path))
        with self.assertRaisesRegex(shotcut.SpecError, "overwrite an input"):
            shotcut.run_build(args, self.tools)
        self.assertEqual(path.read_text(), original)

    def test_empty_output_does_not_replace_existing_output(self):
        path = self.directory / "still-0s.png"
        path.write_bytes(b"previous output")
        with patch.object(shotcut, "probe_duration", return_value=1), \
             patch.object(shotcut, "run_tool", return_value=""), \
             self.assertRaisesRegex(shotcut.ToolError, "without producing output"):
            shotcut.write_stills(self.tools, "video.mp4", str(self.directory / "still.png"), "0")
        self.assertEqual(path.read_bytes(), b"previous output")
        self.assertEqual(list(self.directory.glob(".shotcut-*")), [])

    def test_invalid_timestamps_do_not_start_extraction(self):
        for timestamps in ("", "abc", "-1", "nan", "inf", "1", "0,1", "0,0.0"):
            with self.subTest(timestamps=timestamps), \
                 patch.object(shotcut, "probe_duration", return_value=1), \
                 patch.object(shotcut, "run_tool") as run, self.assertRaises(shotcut.SpecError):
                shotcut.write_stills(self.tools, "video.mp4", str(self.directory / "still.png"), timestamps)
            run.assert_not_called()

    def test_invalid_probe_results_are_tool_errors(self):
        for result in ("N/A", "nan", "inf", "0", "-1"):
            with self.subTest(result=result), patch.object(shotcut, "run_tool", return_value=result), \
                 self.assertRaises(shotcut.ToolError):
                shotcut.probe_duration(self.tools, "video.mp4")

    def test_preview_dimensions_remain_even_and_preserve_rate(self):
        project = self.directory / "project.mlt"
        project.write_text('<mlt><profile width="1918" height="1078" frame_rate_num="30000" '
                           'frame_rate_den="1001" progressive="1"/></mlt>')
        commands = []

        def render(command, capture=True):
            commands.append(command)
            output = next(arg for arg in command if arg.startswith("avformat:"))
            Path(output.removeprefix("avformat:")).write_bytes(b"rendered")

        args = Namespace(project=str(project), output=str(self.directory / "preview.mp4"), preview=True)
        with patch.object(shotcut, "run_tool", side_effect=render), \
             patch.object(shotcut, "probe_duration", return_value=1), \
             patch.object(shotcut, "require_video_stream"), contextlib.redirect_stdout(io.StringIO()):
            shotcut.run_render(args, self.tools)
        self.assertEqual(len(commands), 1)
        self.assertIn("vcodec=libx264", commands[0])
        for value in ("width=958", "height=538", "frame_rate_num=30000", "frame_rate_den=1001"):
            self.assertIn(value, commands[0])
        self.assertEqual(Path(args.output).read_bytes(), b"rendered")

    def test_render_retries_audio_only_or_failed_codec(self):
        for first_failure in ("audio-only", "tool-error", "bad-duration"):
            with self.subTest(first_failure=first_failure):
                output = self.directory / "fallback.mp4"
                commands = []

                def run(command, capture=True):
                    if command[0] == "melt":
                        commands.append(command)
                        if len(commands) > 1:
                            self.assertFalse(output.exists())
                        output.write_bytes(b"rendered")
                        if len(commands) == 1 and first_failure == "tool-error":
                            raise shotcut.ToolError("encoder unavailable")
                        return ""
                    if "format=duration" in command:
                        return "0" if len(commands) == 1 and first_failure == "bad-duration" else "2"
                    return "" if len(commands) == 1 else "video\n"

                with patch.object(shotcut, "run_tool", side_effect=run), \
                     contextlib.redirect_stderr(io.StringIO()):
                    duration = shotcut.render_with_fallback_codecs(
                        self.tools, "project.mlt", str(output), shotcut.PREVIEW_ENCODING)
                self.assertEqual(duration, 2)
                self.assertEqual(len(commands), 2)
                self.assertIn("vcodec=libx264", commands[0])
                self.assertIn("preset=veryfast", commands[0])
                self.assertIn("vcodec=libopenh264", commands[1])
                self.assertIn("vb=4M", commands[1])
                self.assertFalse(any(arg.startswith(("crf=", "preset=")) for arg in commands[1]))
                output.unlink()

    def test_render_tries_mpeg4_after_two_failed_codecs(self):
        with patch.object(shotcut, "run_tool") as run, \
             patch.object(shotcut, "probe_duration", return_value=2), \
             patch.object(shotcut, "require_video_stream", side_effect=[
                 shotcut.ToolError("no video"), shotcut.ToolError("no video"), None]), \
             contextlib.redirect_stderr(io.StringIO()):
            shotcut.render_with_fallback_codecs(self.tools, "project.mlt", "output.mp4",
                                                 shotcut.FINAL_ENCODING)
        self.assertEqual(run.call_count, 3)
        self.assertIn("vcodec=mpeg4", run.call_args.args[0])

    def test_all_failed_codecs_preserve_previous_output(self):
        project = self.directory / "project.mlt"
        project.write_text("<mlt/>")
        output = self.directory / "previous.mp4"
        output.write_bytes(b"previous video")

        def render(command, capture=True):
            path = next(arg.removeprefix("avformat:") for arg in command if arg.startswith("avformat:"))
            Path(path).write_bytes(b"audio-only")

        with patch.object(shotcut, "run_tool", side_effect=render) as run, \
             patch.object(shotcut, "probe_duration", return_value=2), \
             patch.object(shotcut, "require_video_stream", side_effect=shotcut.ToolError("no video")), \
             contextlib.redirect_stderr(io.StringIO()), \
             self.assertRaisesRegex(shotcut.ToolError, "all video codecs"):
            shotcut.run_render(Namespace(project=str(project), output=str(output), preview=False), self.tools)
        self.assertEqual(run.call_count, 3)
        self.assertEqual(output.read_bytes(), b"previous video")
        self.assertEqual(list(self.directory.glob(".shotcut-*")), [])

    def test_render_rejects_output_colliding_with_source_media(self):
        media = self.directory / "source.mp4"
        media.write_bytes(b"original media")
        project = self.directory / "project.mlt"
        project.write_text('<mlt><producer><property name="resource">source.mp4</property></producer></mlt>')
        with self.assertRaisesRegex(shotcut.SpecError, "overwrite an input"):
            shotcut.run_render(Namespace(project=str(project), output=str(media), preview=False), self.tools)
        self.assertEqual(media.read_bytes(), b"original media")

    def test_bad_profile_and_missing_executable_raise_expected_errors(self):
        project = self.directory / "project.mlt"
        project.write_text('<mlt><profile width="bad"/></mlt>')
        with self.assertRaises(shotcut.SpecError):
            shotcut.read_profile(str(project))
        with self.assertRaises(shotcut.ToolError):
            shotcut.run_tool([str(self.directory / "missing-tool")])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg unavailable")
    def test_real_frame_extraction_and_contact_sheet(self):
        video = self.directory / "video.mp4"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
                        "color=c=red:s=160x90:r=30:d=1", "-c:v", "mpeg4", "-threads", "1", str(video)],
                       check=True, capture_output=True)
        tools = shotcut.Tools(None, shutil.which("ffmpeg"), shutil.which("ffprobe"))
        with contextlib.redirect_stdout(io.StringIO()):
            shotcut.write_stills(tools, str(video), str(self.directory / "still.png"), "0,0.5")
            shotcut.write_contact_sheet(tools, str(video), str(self.directory / "sheet.png"), 5)
        for name in ("still-0s.png", "still-0.5s.png", "sheet.png"):
            self.assertTrue((self.directory / name).read_bytes().startswith(b"\x89PNG"))
        with self.assertRaises(shotcut.SpecError):
            shotcut.write_stills(tools, str(video), str(self.directory / "too-late.png"), "2")
        self.assertFalse((self.directory / "too-late-2s.png").exists())


if __name__ == "__main__":
    unittest.main()

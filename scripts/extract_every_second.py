#!/usr/bin/env python3
"""Extract fixed-interval video frames and build timestamped contact sheets."""

import argparse
import csv
import glob
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def find_ffmpeg():
    candidates = []
    env_path = os.environ.get("FFMPEG_PATH")
    if env_path:
        candidates.append(Path(env_path))
    on_path = shutil.which("ffmpeg")
    if on_path:
        candidates.append(Path(on_path))

    home = Path.home()
    candidates.extend(
        [
            home / ".codex/tools/imageio_ffmpeg/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe",
            home / ".codex/tools/ffmpeg/bin/ffmpeg.exe",
        ]
    )
    candidates.extend(Path(p) for p in glob.glob(str(home / ".codex/tools/ffmpeg/**/ffmpeg.exe"), recursive=True))
    candidates.extend(Path(p) for p in glob.glob(str(home / ".codex/tools/imageio_ffmpeg/**/ffmpeg*.exe"), recursive=True))

    try:
        import imageio_ffmpeg  # type: ignore

        candidates.append(Path(imageio_ffmpeg.get_ffmpeg_exe()))
    except Exception:
        pass

    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise FileNotFoundError("FFmpeg was not found. Set FFMPEG_PATH or install imageio-ffmpeg.")


def find_drawtext_font():
    candidates = []
    env_path = os.environ.get("MANJING_CONTACT_SHEET_FONT")
    if env_path:
        candidates.append(Path(env_path))
    candidates.extend(
        [
            Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc"),
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("C:/Windows/Fonts/arial.ttf"),
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def escape_ffmpeg_filter_path(path):
    return str(path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def run(command, log_path=None, allow_failure=False):
    # Python 3.6 does not support subprocess.run(text=True, capture_output=True).
    result = subprocess.run(
        command,
        universal_newlines=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
    )
    combined = (result.stdout or "") + (result.stderr or "")
    if log_path is not None:
        log_path.write_text(combined, encoding="utf-8")
    if result.returncode != 0 and not allow_failure:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}\n{combined[-4000:]}")
    return result


def parse_duration(text):
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def timecode(seconds):
    whole = int(round(seconds))
    hours, remainder = divmod(whole, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_video", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between frames (default: 1)")
    parser.add_argument("--cols", type=int, default=5)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--thumb-width", type=int, default=320)
    parser.add_argument("--max-duration", type=float, default=600.0, help="Reject videos longer than this many seconds")
    parser.add_argument("--frame-width", type=int, default=1920, help="Maximum extracted frame width")
    args = parser.parse_args()

    video = args.input_video.expanduser().resolve()
    out = args.output_dir.expanduser().resolve()
    if not video.is_file():
        parser.error(f"Input video does not exist: {video}")
    if any(value <= 0 for value in (args.interval, args.cols, args.rows, args.thumb_width, args.max_duration, args.frame_width)):
        parser.error("interval, layout, duration, and width limits must be positive")

    frames = out / "frames"
    sheets = out / "contact_sheets"
    frames.mkdir(parents=True, exist_ok=True)
    sheets.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()

    metadata = run([str(ffmpeg), "-hide_banner", "-i", str(video)], allow_failure=True)
    metadata_text = (metadata.stdout or "") + (metadata.stderr or "")
    (out / "metadata.txt").write_text(metadata_text, encoding="utf-8")
    duration = parse_duration(metadata_text)
    if duration is None:
        raise RuntimeError("Unable to determine video duration")
    if duration > args.max_duration:
        raise RuntimeError(
            f"Video duration {duration:.2f}s exceeds the {args.max_duration:.0f}s analysis limit"
        )

    frame_pattern = frames / "frame_%06d.jpg"
    extraction_filter = f"fps=1/{args.interval},scale='min({args.frame_width},iw)':-2"
    run(
        [
            str(ffmpeg), "-hide_banner", "-loglevel", "warning", "-y",
            "-i", str(video), "-vf", extraction_filter,
            "-q:v", "2", str(frame_pattern),
        ],
        log_path=out / "frame_extraction.txt",
    )

    frame_files = sorted(frames.glob("frame_*.jpg"))
    if not frame_files:
        raise RuntimeError("No frames were extracted")

    with (out / "manifest.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frame", "seconds", "timecode", "file"])
        for index, frame in enumerate(frame_files):
            seconds = index * args.interval
            writer.writerow([index + 1, f"{seconds:.3f}", timecode(seconds), str(frame)])

    font = find_drawtext_font()
    tile_count = args.cols * args.rows
    frame_rate = f"1/{args.interval}"
    font_option = f"fontfile='{escape_ffmpeg_filter_path(font)}':" if font else ""
    filter_chain = (
        f"scale={args.thumb_width}:-2,"
        f"drawtext={font_option}text='%{{pts\\:hms}}':"
        "x=8:y=8:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=5,"
        f"tile={args.cols}x{args.rows}:nb_frames={tile_count}:padding=6:margin=12:color=white"
    )
    sheet_count = math.ceil(len(frame_files) / tile_count)
    run(
        [
            str(ffmpeg), "-hide_banner", "-loglevel", "warning", "-y",
            "-framerate", frame_rate, "-start_number", "1", "-i", str(frame_pattern),
            "-vf", filter_chain, "-frames:v", str(sheet_count), "-vsync", "vfr",
            "-q:v", "2", str(sheets / "sheet_%03d.jpg"),
        ],
        log_path=out / "contact_sheet_generation.txt",
    )

    run(
        [
            str(ffmpeg), "-hide_banner", "-nostats", "-i", str(video),
            "-vn", "-af", "silencedetect=noise=-40dB:d=0.35", "-f", "null", "-",
        ],
        log_path=out / "audio_silence.txt",
        allow_failure=True,
    )

    summary = {
        "input_video": str(video),
        "output_dir": str(out),
        "ffmpeg": str(ffmpeg),
        "duration_seconds": duration,
        "interval_seconds": args.interval,
        "max_duration_seconds": args.max_duration,
        "max_frame_width": args.frame_width,
        "frame_count": len(frame_files),
        "contact_sheet_count": len(list(sheets.glob("sheet_*.jpg"))),
        "contact_sheet_layout": f"{args.cols}x{args.rows}",
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

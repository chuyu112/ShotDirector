import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const extractorPath = new URL("../scripts/extract_every_second.py", import.meta.url);
const ffmpegInstallerPath = new URL("../deploy/install-ffmpeg-static.sh", import.meta.url);

test("video extractor parses with the server Python 3.6 grammar", async (t) => {
  const source = await readFile(extractorPath, "utf8");
  const python = process.env.MANJING_PYTHON || "python3";
  const result = spawnSync(python, [
    "-c",
    "import ast,sys; ast.parse(sys.stdin.read(), filename='extract_every_second.py', feature_version=(3,6))",
  ], {
    input: source,
    encoding: "utf8",
  });
  if (result.error?.code === "ENOENT") {
    t.skip(`${python} is unavailable`);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(source, /from __future__ import annotations|list\[[^\]]+\]|\bPath\s*\|\s*None/u);
  assert.match(source, /universal_newlines=True/u);
});

test("video extractor supports Linux fonts and FFmpeg 4.x output flags", async () => {
  const source = await readFile(extractorPath, "utf8");
  assert.match(source, /\/usr\/share\/fonts\/dejavu\/DejaVuSans\.ttf/u);
  assert.match(source, /MANJING_CONTACT_SHEET_FONT/u);
  assert.match(source, /"-vsync", "vfr"/u);
  assert.doesNotMatch(source, /"-fps_mode", "vfr"/u);
});

test("static FFmpeg installer pins and verifies both wheel and binary", async () => {
  const source = await readFile(ffmpegInstallerPath, "utf8");
  assert.match(source, /imageio_ffmpeg-0\.4\.9-py3-none-manylinux2010_x86_64\.whl/u);
  assert.match(source, /WHEEL_SHA256="[a-f0-9]{64}"/u);
  assert.match(source, /BINARY_SHA256="[a-f0-9]{64}"/u);
  assert.match(source, /sha256sum -c -/u);
  assert.match(source, /grep -q drawtext/u);
});

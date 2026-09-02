#!/bin/sh
set -eu

# Alibaba Cloud Linux 3 does not expose FFmpeg in its default repositories.
# This extracts the static x86_64 binary from a pinned, checksummed PyPI wheel.
WHEEL_URL="https://files.pythonhosted.org/packages/1a/98/3df1d8dd8f2c121b6c588b1e0d604f36592d56df9c41fb155ed546c6a5ed/imageio_ffmpeg-0.4.9-py3-none-manylinux2010_x86_64.whl"
WHEEL_SHA256="2996c64af3e5489227096580269317719ea1a8121d207f2e28d6c24ebc4a253e"
BINARY_MEMBER="imageio_ffmpeg/binaries/ffmpeg-linux64-v4.2.2"
BINARY_SHA256="700073daef5c23bbcb18c2eae60553a454a5221ec19b4a88c8c367a664671a7c"
TARGET="${1:-/usr/local/bin/ffmpeg}"

case "$TARGET" in
  /*) ;;
  *)
    echo "target must be an absolute path" >&2
    exit 2
    ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM
wheel="$tmp_dir/imageio-ffmpeg.whl"
binary="$tmp_dir/ffmpeg"

curl -fL --retry 3 -o "$wheel" "$WHEEL_URL"
printf '%s  %s\n' "$WHEEL_SHA256" "$wheel" | sha256sum -c -
python3 - "$wheel" "$BINARY_MEMBER" "$binary" <<'PY'
import shutil
import sys
import zipfile

wheel, member, output = sys.argv[1:]
with zipfile.ZipFile(wheel) as archive, archive.open(member) as source, open(output, "wb") as target:
    shutil.copyfileobj(source, target)
PY
printf '%s  %s\n' "$BINARY_SHA256" "$binary" | sha256sum -c -
install -o root -g root -m 0755 "$binary" "$TARGET"
"$TARGET" -version | head -n 3
"$TARGET" -hide_banner -filters | grep -q drawtext
echo "FFmpeg installed with drawtext support: $TARGET"

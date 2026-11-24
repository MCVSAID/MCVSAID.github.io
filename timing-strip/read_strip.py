#!/usr/bin/env python3
# Copyright (c) 2026 The MCVSAID authors. MIT licence:
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
# documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
# rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
# persons to whom the Software is furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
# Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
# WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
# COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
# OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
"""Reference reader for the MCVSAID timing strip, version 1 (https://mcvsaid.com/timing-strip/).
Pure Python 3 plus the ffmpeg command-line tool.

Reads every frame of a file or a live stream, decodes the strip and prints what it says:

    python3 read_strip.py example-1080p30.mp4
    python3 read_strip.py "srt://192.0.2.10:9000?mode=caller"     # needs an ffmpeg built with libsrt
    python3 read_strip.py --live "srt://:9000?mode=listener"      # also prints each frame's age on this computer's clock
    python3 read_strip.py --near 2026-01-01 example-1080p30.mp4

The strip carries only the low 32 bits of the millisecond clock (they repeat every 49.7 days), so the full date is
taken as the one nearest now, or nearest --near for a recording made long ago (the example video: 2026-01-01).

For each frame: its number, the time in the strip (UTC), the step from the frame before, and with --live how long ago
that was by this computer's clock (meaningful only when the camera and this computer share an NTP server).
A summary at the end says how many frames could not be read.
"""
import datetime
import subprocess
import sys
import time

CELLS = 44
STRIP_FRACTION = 16 / 1080


def check(value):
    return ((value >> 24) ^ (value >> 16) ^ (value >> 8) ^ value ^ 0x5A) & 0xFF


def decode(cells):
    """44 cells (True = white) to the 32-bit value, or None when the end markers or the check byte are wrong."""
    if len(cells) != CELLS or not cells[0] or cells[1] or not cells[42] or not cells[43]: return None
    value = 0
    for bit in cells[2:34]: value = value << 1 | bit
    wanted = 0
    for bit in cells[34:42]: wanted = wanted << 1 | bit
    return value if check(value) == wanted else None


def read_frame(grey, width, height):
    """The 32-bit value from one 8-bit grey frame (row-major bytes), trying the top and bottom edges, both directions."""
    strip = max(3, round(height * STRIP_FRACTION))
    rows = range(max(1, strip // 3), max(2, strip - strip // 3))           # the middle third of the strip's rows
    for edge in (0, height - strip):
        levels = []
        for cell in range(CELLS):
            centre = int((cell + 0.5) * width / CELLS)
            samples = [grey[(edge + y) * width + x] for y in rows for x in (centre - 2, centre, centre + 2)]
            levels.append(sum(samples) / len(samples))
        low, high = min(levels), max(levels)
        if high - low < 60: continue                                        # picture content, not a strip
        cells = [level > (low + high) / 2 for level in levels]
        for candidate in (cells, cells[::-1]):
            value = decode(candidate)
            if value is not None: return value
    return None


def expand(value, near_ms):
    """The full UTC millisecond time whose low 32 bits are `value`, closest to `near_ms`."""
    base = (int(near_ms) >> 32) << 32
    return min((base + shift + value for shift in (-(1 << 32), 0, 1 << 32)), key=lambda t: abs(t - near_ms))


def size_of(source):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'csv=p=0', source], capture_output=True, text=True, timeout=30).stdout.strip()
    width, height = out.splitlines()[0].split(',')[:2]
    return int(width), int(height)


def main():
    args, live, near = sys.argv[1:], False, time.time() * 1000
    if '--live' in args: args.remove('--live'); live = True
    if '--near' in args:
        at = args.index('--near')
        near = datetime.datetime.fromisoformat(args[at + 1]).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000
        del args[at:at + 2]
    if len(args) != 1: sys.exit(__doc__)
    source = args[0]
    width, height = size_of(source)
    ffmpeg = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', source, '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:'],
                              stdout=subprocess.PIPE)
    frame_bytes, n, unread, previous = width * height, 0, 0, None
    try:
        while True:
            grey = ffmpeg.stdout.read(frame_bytes)
            if len(grey) < frame_bytes: break
            arrived = time.time() * 1000
            value = read_frame(grey, width, height)
            if value is None:
                unread += 1
                print(f'{n:6d}  (no strip read)')
            else:
                full = expand(value, previous if previous is not None else near)
                when = datetime.datetime.fromtimestamp(full / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
                step = '' if previous is None else f'  step {full - previous:+5d} ms'
                age = f'  age {arrived - full:7.0f} ms' if live else ''
                print(f'{n:6d}  {when} UTC{step}{age}')
                previous = full
            n += 1
    except KeyboardInterrupt:
        pass
    finally:
        ffmpeg.kill()
    print(f'{n} frames, {n - unread} read, {unread} without a readable strip')


if __name__ == '__main__':
    main()

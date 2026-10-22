#!/usr/bin/env python3
"""Build the sales video, fitted to whatever voiceover is in vo/.

Voice options (any one):
  vo/<scene id>.mp3|.wav|.m4a  one clip per scene (tts_google.py makes these,
                               or record your own with the same names)
  vo/full.mp3|.wav|.m4a        one recording of the whole script, timed to the
                               default cut (see "Voiceover script.md")
  nothing                      silent, captioned cut
Optional: music.mp3 — a licensed music bed, mixed quietly under the voice.

Each scene lasts max(its default length, its clip + a short tail), so a new
voice or a reworded line never cuts off. Output: "InjuryCase sales video.mp4".
Needs node + Playwright (Chromium) and ffmpeg.
  python3 build_video.py [--fps 30] [--out "InjuryCase sales video.mp4"]
"""
import argparse, json, os, shutil, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
EXTS = ('.mp3', '.wav', '.m4a')


def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode().strip())


def find(base):
    for e in EXTS:
        p = os.path.join(HERE, 'vo', base + e)
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--fps', type=int, default=30); ap.add_argument('--out', default='InjuryCase sales video.mp4')
    ap.add_argument('--work', default=os.path.join(HERE, '.build'))
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, 'scenes.json')))
    lead, tail = cfg.get('lead_in_seconds', 0.4), cfg.get('tail_seconds', 0.9)
    full = find('full')
    clips = [None if full else find(s['id']) for s in cfg['scenes']]
    durations = []
    for s, c in zip(cfg['scenes'], clips):
        d = s['min'] if not c else max(s['min'], round(lead + dur(c) + tail, 2))
        durations.append(d)
        print(f"{s['id']:16} {d:5.1f}s  {os.path.basename(c) if c else ('full track' if full else 'silent')}")
    total = sum(durations)
    os.makedirs(a.work, exist_ok=True)
    json.dump(durations, open(os.path.join(HERE, 'timeline.json'), 'w'))
    frames = os.path.join(a.work, 'frames')
    shutil.rmtree(frames, ignore_errors=True)
    subprocess.check_call(['node', os.path.join(HERE, 'render.js'), HERE, str(a.fps), '', os.path.join(HERE, 'timeline.json'), frames])
    silent = os.path.join(a.work, 'video_only.mp4')
    subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', os.path.join(frames, '%05d.jpg'),
                           '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', silent])
    # Audio: each clip placed at its scene start (+ lead-in), or the full track; optional music bed.
    inputs, filters, mix = [], [], []
    if full:
        inputs += ['-i', full]; filters.append('[0:a]aresample=48000,apad[v0]'); mix.append('[v0]')
    else:
        start = 0.0
        for c, d in zip(clips, durations):
            if c:
                i = len(inputs) // 2
                inputs += ['-i', c]
                ms = int((start + lead) * 1000)
                filters.append(f'[{i}:a]aresample=48000,adelay={ms}|{ms}[v{i}]'); mix.append(f'[v{i}]')
            start += d
    music = os.path.join(HERE, 'music.mp3')
    if os.path.exists(music):
        i = len(inputs) // 2
        inputs += ['-stream_loop', '-1', '-i', music]
        filters.append(f'[{i}:a]aresample=48000,volume={0.12 if mix else 0.35},afade=t=out:st={max(0, total - 3)}:d=3[m]'); mix.append('[m]')
    out = os.path.join(HERE, a.out)
    if not mix:
        subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-i', silent, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
                               '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out])
    else:
        fc = ';'.join(filters) + ';' + ''.join(mix) + f'amix=inputs={len(mix)}:normalize=0:duration=longest,apad,atrim=0:{total},loudnorm=I=-16:TP=-1.5[a]'
        subprocess.check_call(['ffmpeg', '-loglevel', 'error', '-y', '-i', silent, *inputs, '-filter_complex', fc_shift(fc, 1),
                               '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', str(total), out])
    print(f'wrote {a.out} ({total:.1f}s)')


def fc_shift(fc, n):
    """Audio inputs follow the video input, so input labels shift by one."""
    import re
    return re.sub(r'\[(\d+):a\]', lambda m: f'[{int(m.group(1)) + n}:a]', fc)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Generate the voiceover with Google Cloud Text-to-Speech.

Reads the lines and voice settings from scenes.json and writes one MP3 per
scene to vo/<scene id>.mp3. Needs an API key with the Text-to-Speech API
enabled, in the GOOGLE_TTS_API_KEY environment variable (never commit it).

  python3 tts_google.py                      # all scenes, voice from scenes.json
  python3 tts_google.py --voice en-US-Studio-Q
  python3 tts_google.py --only 04-playbook   # redo one scene
  python3 tts_google.py --list en-US         # show available voices
Then run build_video.py.
"""
import argparse, base64, json, os, sys, urllib.request, urllib.error

API = 'https://texttospeech.googleapis.com/v1/'
HERE = os.path.dirname(os.path.abspath(__file__))


def call(path, body=None):
    key = os.environ.get('GOOGLE_TTS_API_KEY')
    if not key:
        sys.exit('Set GOOGLE_TTS_API_KEY (a Google Cloud API key with the Text-to-Speech API enabled).')
    req = urllib.request.Request(API + path + ('&' if '?' in path else '?') + 'key=' + key,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f'Google TTS error {e.code}: {e.read().decode()[:400]}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice'); ap.add_argument('--rate', type=float); ap.add_argument('--only'); ap.add_argument('--list', metavar='LANG')
    a = ap.parse_args()
    if a.list:
        for v in call('voices?languageCode=' + a.list).get('voices', []):
            print(f"{v['name']:32} {v['ssmlGender']:7} {v.get('naturalSampleRateHertz', '')}")
        return
    cfg = json.load(open(os.path.join(HERE, 'scenes.json')))
    voice = cfg['voice']
    name = a.voice or voice['name']
    os.makedirs(os.path.join(HERE, 'vo'), exist_ok=True)
    for sc in cfg['scenes']:
        if a.only and sc['id'] != a.only:
            continue
        audio = {'audioEncoding': 'MP3', 'speakingRate': a.rate or voice.get('speakingRate', 1.0), 'sampleRateHertz': 48000}
        if 'Chirp' not in name:  # Chirp 3 HD voices don't take pitch
            audio['pitch'] = voice.get('pitch', 0.0)
        r = call('text:synthesize', {'input': {'text': sc['text']}, 'voice': {'languageCode': voice.get('languageCode', 'en-US'), 'name': name}, 'audioConfig': audio})
        out = os.path.join(HERE, 'vo', sc['id'] + '.mp3')
        open(out, 'wb').write(base64.b64decode(r['audioContent']))
        print('wrote', os.path.relpath(out, HERE))


if __name__ == '__main__':
    main()

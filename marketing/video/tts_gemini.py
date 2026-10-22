#!/usr/bin/env python3
"""Generate the voiceover with Gemini's text-to-speech.

Works with a plain Gemini API key (GEMINI_API_KEY, never commit it), unlike
Google Cloud TTS which needs its own key. Reads the lines from scenes.json and
writes one WAV per scene to vo/<scene id>.wav (or the scene file's "vo_dir").
Voice and delivery come from the scene file's "gemini" block.

  python3 tts_gemini.py                      # all scenes
  python3 tts_gemini.py --voice Kore         # try another voice
  python3 tts_gemini.py --only 04-playbook   # redo one scene
  python3 tts_gemini.py --sample Charon,Kore,Puck,Algieba   # one line per voice, to compare
  python3 tts_gemini.py --scenes walkthrough.json           # the long walkthrough
Then run build_video.py.
"""
import argparse, base64, json, os, sys, time, urllib.request, urllib.error, wave

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'


def synth(text, voice, model, style):
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        sys.exit('Set GEMINI_API_KEY.')
    body = {'contents': [{'parts': [{'text': f'{style}:\n{text}' if style else text}]}],
            'generationConfig': {'responseModalities': ['AUDIO'],
                                 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}}
    req = urllib.request.Request(URL.format(model=model), data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                part = json.load(r)['candidates'][0]['content']['parts'][0]['inlineData']
            return base64.b64decode(part['data'])  # 16-bit mono PCM, 24 kHz
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(5 * 2 ** attempt); continue
            sys.exit(f'Gemini TTS error {e.code}: {e.read().decode()[:400]}')
        except (KeyError, IndexError):
            if attempt < 3:
                continue
            sys.exit('Gemini returned no audio for: ' + text[:60])


def save(pcm, path):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
    print('wrote', os.path.relpath(path, HERE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice'); ap.add_argument('--only'); ap.add_argument('--sample', metavar='VOICES'); ap.add_argument('--scenes', default='scenes.json')
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(HERE, a.scenes)))
    vo = os.path.join(HERE, cfg.get('vo_dir', 'vo'))
    g = cfg.get('gemini', {})
    model, style = g.get('model', 'gemini-2.5-flash-preview-tts'), g.get('style', '')
    if a.sample:
        os.makedirs(os.path.join(vo, 'samples'), exist_ok=True)
        line = cfg['scenes'][1]['text']
        for v in a.sample.split(','):
            save(synth(line, v.strip(), model, style), os.path.join(vo, 'samples', v.strip() + '.wav'))
        return
    voice = a.voice or g.get('voice', 'Charon')
    os.makedirs(vo, exist_ok=True)
    for sc in cfg['scenes']:
        if a.only and sc['id'] != a.only:
            continue
        for ext in ('.mp3', '.m4a'):  # build_video.py takes the first match, so clear stale clips
            if os.path.exists(os.path.join(vo, sc['id'] + ext)):
                os.remove(os.path.join(vo, sc['id'] + ext))
        save(synth(sc['text'], voice, model, style), os.path.join(vo, sc['id'] + '.wav'))


if __name__ == '__main__':
    main()

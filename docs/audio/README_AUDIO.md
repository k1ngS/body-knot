# BODY//KNOT — Audio Documentation

This document records the origin, purpose and recommended integration
of the final audio assets used by BODY//KNOT.

## Voice

The spoken voice assets were generated with Gemini Text-to-Speech and
edited manually by Marcos Beltrão using Audacity.

The final exported files are stored in:

`public/audio/voice/`

## Original procedural audio pack

The ambience, heartbeat and selected sound effects were procedurally
generated specifically for BODY//KNOT.

No external audio samples were used in these files.

The final exported files are stored in:

- `public/audio/ambience/`
- `public/audio/sfx/`

## Technical format

- WAV

- 24 kHz

- 16-bit PCM

- Voice files: mono

- Ambience and selected SFX: mono or stereo according to purpose



Generated as original procedural audio for this project. No external samples were used.
No attribution is required for these files.



FILES
- ambience_organic_loop_16s.wav — seamless stereo ambient loop
- heartbeat_loop_12s.wav — seamless mono heartbeat loop
- revelation_voice_bed_13s.wav — complete low-volume bed for the four reveal lines
- sfx_eye_open.wav — eye-opening transition
- sfx_you_are_pressure.wav — restrained low-pressure accent for “YOU ARE”
- sfx_observer_lock.wav — cursor lock accent
- sfx_signal_sever.wav — failure/disconnection accent
- sfx_host_bind.wav — successful Core binding accent

RECOMMENDED REVEAL TIMELINE
00.20  see_the_hand.wav
04.15  it_moves.wav
06.90  not_the_parasite.wav
10.75  you_are.wav
12.90  enable RUN / LET ME OUT

Original Mix Starting Points
- Voice channel: 1.00
- revelation_voice_bed_13s.wav: 0.22–0.32
- ambience loop while voice is active: 0.20–0.30
- heartbeat while voice is active: 0.20–0.28
- sfx_eye_open.wav: 0.45–0.60
- sfx_you_are_pressure.wav: 0.28–0.40
- other SFX during spoken lines: 0.25–0.45

Do not play the standalone ambience and heartbeat at full volume on top of the 13-second voice bed.
Use either:
A) revelation_voice_bed_13s.wav as the main reveal background; or
B) ambience + heartbeat separately with volume ducking.

All WAV files are 24 kHz, signed 16-bit PCM.
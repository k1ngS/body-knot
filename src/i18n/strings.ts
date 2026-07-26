export const strings = {
  title: "BODY//KNOT",
  eyebrow: "SUBJECT 32 // DORMANT",
  menuTag:
    "Cross your living chain around immune cells. Grow before the host learns how you move.",
  enter: "ENTER HOST",
  settings: "SETTINGS",
  audioNotice: "CLICKING ENTER ENABLES AUDIO",
  prompts: {
    circle: "CIRCLE THEM.",
    cross: "CROSS THE GLOWING LINK.",
    free: "CROSS THE CHAIN. TAKE MORE.",
    larger: "MAKE A LARGER KNOT.",
    cursor: "YOUR HAND IS WARM.",
  },
  revealLines: [
    "I SEE YOU.",
    "IT STOPS WHEN YOU STOP.",
    "IT MOVES WHEN YOU MOVE.",
    "THAT THING IS NOT THE PARASITE.",
    "YOU ARE.",
  ],
  endingA: "YOU ARE THE PARASITE.",
  endingB: "THE HOST REMEMBERS YOUR HAND.",
  run: "RUN",
  resume: "RESUME",
  quit: "QUIT",
  letMeOut: "LET ME OUT",
  restart: "RESTART",
  paused: "PAUSED",
  pointer: "POINTER ACQUIRED",
  observerWarning: "KEEP YOUR CURSOR AWAY FROM YOUR BODY",
  hud: {
    stable: "HOST SIGNAL // STABLE",
    contaminated: "HOST SIGNAL // CONTAMINATED",
    membrane: "MEMBRANE 32x32",
    controls: "Space dashes. Cross your own chain.",
  },
  settingsLabels: {
    audio: "Audio",
    captions: "Captions",
    reducedMotion: "Reduced motion",
    shake: "Screen shake",
    highContrast: "High contrast",
    voice: "Voice",
    effects: "Effects",
  },
};

export const voiceClips = {
  back_again: "/audio/back_again.mp3",
  get_out: "/audio/get_out.mp3",
  i_see_you: "/audio/i_see_you.mp3",
  it_moves: "/audio/it_moves.mp3",
  it_stops: "/audio/it_stops.mp3",
  let_me_out: "/audio/let_me_out.mp3",
  not_the_parasite: "/audio/not_the_parasite.mp3",
  you_are: "/audio/you_are.mp3",
} as const;

export type VoiceClipKey = keyof typeof voiceClips;

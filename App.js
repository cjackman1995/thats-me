// That's Me! — a child drags scrambled letters into place to spell their own name.
// Every touch says the letter; finishing the name spells it out loud, then says the name.
// Level 1 (Build it): drag scrambled letters into place.
// Level 2 (Dino dig): the name is buried in dirt; rub it away with a little shovel.
// Level 3 (Sand trace): trace the name, in handwriting letters, in the sand at the beach.
// The home screen is just for kids; grown-ups set the name in Settings, and it's saved.
// Plays in landscape, with the whole name on one line.
// Dependencies (Snack will offer to add them): expo-speech, expo-screen-orientation,
// react-native-safe-area-context, react-native-svg, @react-native-async-storage/async-storage, expo-audio

import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Switch,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
import * as ScreenOrientation from 'expo-screen-orientation';
import Svg, { Path, Line, G } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------- Look ----------
const C = {
  mat: '#EAF4F0', // play mat
  card: '#FFFFFF',
  ink: '#1F3A33',
  inkSoft: '#5E7A72',
  slotBg: '#F7FCFA',
  slotLine: '#B4D1C6',
  ghost: '#9FC3B6',
  go: '#FF6B5B',
  goEdge: '#D9473A',
  blue: '#3D8BFD',
  blueSoft: '#E2EEFF',
  blueInk: '#2668D4',
};

const TILE_COLORS = [
  { bg: '#FF6B5B', edge: '#D9473A', fg: '#FFFFFF' },
  { bg: '#3D8BFD', edge: '#2668D4', fg: '#FFFFFF' },
  { bg: '#FFC93C', edge: '#E0A400', fg: '#5A3B00' },
  { bg: '#34C38F', edge: '#22996D', fg: '#FFFFFF' },
  { bg: '#A66CFF', edge: '#7E47D6', fg: '#FFFFFF' },
  { bg: '#FF8FB1', edge: '#E0628A', fg: '#FFFFFF' },
  { bg: '#20C3D0', edge: '#1597A2', fg: '#FFFFFF' },
  { bg: '#FF9F43', edge: '#DD7A1C', fg: '#FFFFFF' },
];

// ---------- Speech ----------
// The chosen voice is shared by everything that talks.
let chosenVoice = null;

const speakOpts = (extra = {}) => ({
  rate: 0.85,
  pitch: 1.05,
  language: 'en-US',
  ...(chosenVoice ? { voice: chosenVoice } : {}),
  ...extra,
});

// A capital letter on its own, followed by a period, is read as the letter's name
// ("A." -> "ay"). Spelled-out sounds like "ay" get misread as "eye" by some voices.
// If one particular letter still sounds wrong, add it here, e.g. { Z: 'zee' }.
const LETTER_OVERRIDES = {};
const letterSound = (ch) => LETTER_OVERRIDES[ch.toUpperCase()] || `${ch.toUpperCase()}.`;

function sayLetter(ch) {
  Speech.stop();
  Speech.speak(letterSound(ch), speakOpts());
}

function sayWords(text) {
  Speech.stop();
  Speech.speak(text, speakOpts({ rate: 0.8 }));
}

// Rank the device's voices so the most natural-sounding English voice comes first.
// Novelty voices (Bubbles, Zarvox, Whisper...) are left out entirely.
const NOVELTY =
  /(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|fred)/i;
const ROBOTIC = /(compact|eloquence|espeak|zira|david|mark|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)/i;

function scoreVoice(v) {
  const name = v.name || '';
  let s = 0;
  if (v.quality && v.quality !== 'Default') s += 6; // iOS "Enhanced" / premium voices
  if (/natural|neural|online|premium|enhanced/i.test(name)) s += 6; // Microsoft natural voices in Edge/Chrome
  if (/google/i.test(name)) s += 4;
  if (/\bana\b/i.test(name)) s += 4; // Microsoft's child voice
  if (/samantha|ava|allison|susan|karen|moira|tessa|serena|nicky|aria|jenny|zoe|evan/i.test(name)) s += 3;
  if ((v.language || '').toLowerCase().replace('_', '-') === 'en-us') s += 1;
  if (ROBOTIC.test(name)) s -= 8;
  return s;
}

function voiceLabel(v) {
  return (v.name || 'Voice')
    .replace(/^(Microsoft|Google)\s+/i, '')
    .replace(/\s*Online\s*\(Natural\)/i, ' (natural)')
    .replace(/\s*-\s*English.*$/i, '')
    .replace(/\s*\((English|United States|US)\)$/i, '')
    .trim();
}

async function loadVoices() {
  // On the web, the browser fills in its voice list a moment after the page loads.
  for (let i = 0; i < 12; i++) {
    try {
      const all = await Speech.getAvailableVoicesAsync();
      if (all && all.length) {
        const seen = new Set();
        return all
          .filter((v) => (v.language || '').toLowerCase().startsWith('en'))
          .filter((v) => !NOVELTY.test(v.name || ''))
          .sort((a, b) => scoreVoice(b) - scoreVoice(a))
          .filter((v) => {
            const key = voiceLabel(v);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
      }
    } catch (e) {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return [];
}

// ---------- Name handling ----------
// Keeps letters as the parent typed them (so "McKenzie" stays "McKenzie").
// If typed all-lowercase or ALL-CAPS, it becomes "Emma" style.
// Spaces, hyphens and apostrophes are shown already in place.
function normalizeName(raw) {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-zÀ-ɏ' -]/g, '');
  const letters = cleaned.replace(/[' -]/g, '');
  const fixCase = letters === letters.toLowerCase() || letters === letters.toUpperCase();
  const out = [];
  let startOfPart = true;
  for (const c of cleaned) {
    if (c === ' ' || c === '-' || c === "'") {
      out.push({ ch: c, fixed: true });
      startOfPart = c !== "'";
    } else {
      const ch = fixCase ? (startOfPart ? c.toUpperCase() : c.toLowerCase()) : c;
      out.push({ ch, fixed: false });
      startOfPart = false;
    }
  }
  return out;
}

const MAX_LETTERS = 14;

// ---------- Layout ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Spreads the letters around the name: above it, below it, and beside it when there's room.
// Picks from each side in turn so letters land on every side, not bunched in one spot.
// Returns null if they don't fit at this size.
function scatterAround(count, size, W, H, pad, avoid) {
  for (const f of [1.5, 1.3, 1.12, 1.03]) {
    const cell = size * f;
    const cols = Math.floor((W - pad * 2) / cell);
    const rows = Math.floor((H - pad * 2) / cell);
    if (cols < 1 || rows < 1) continue;
    const offX = (W - cols * cell) / 2;
    const offY = (H - rows * cell) / 2;
    const groups = { above: [], below: [], left: [], right: [] };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = offX + c * cell;
        const y = offY + r * cell;
        const overlaps = x < avoid.right && x + cell > avoid.left && y < avoid.bottom && y + cell > avoid.top;
        if (overlaps) continue;
        if (y + cell <= avoid.top) groups.above.push({ x, y });
        else if (y >= avoid.bottom) groups.below.push({ x, y });
        else if (x + cell <= avoid.left) groups.left.push({ x, y });
        else groups.right.push({ x, y });
      }
    }
    const lists = Object.values(groups)
      .filter((g) => g.length)
      .map((g) => shuffle(g));
    if (lists.reduce((a, g) => a + g.length, 0) < count) continue;
    const picked = [];
    let k = Math.floor(Math.random() * lists.length);
    while (picked.length < count) {
      const g = lists[k % lists.length];
      if (g.length) picked.push(g.pop());
      k++;
    }
    const wiggle = ((cell - size) / 2) * 0.8;
    return shuffle(picked).map((p) => ({
      x: p.x + (cell - size) / 2 + (Math.random() * 2 - 1) * wiggle,
      y: p.y + (cell - size) / 2 + (Math.random() * 2 - 1) * wiggle,
    }));
  }
  return null;
}

function computeLayout(W, H, chars) {
  const pad = 16;
  const n = chars.length;
  const letterIdx = [];
  chars.forEach((c, i) => {
    if (!c.fixed) letterIdx.push(i);
  });

  // The whole name sits on ONE line in the middle of the screen, as big as the
  // space allows while still leaving room for the letters around it.
  let size = Math.min(160, H * 0.3, (W - pad * 2) / (n + (n - 1) * 0.1));
  let homes = null;
  let gap, slotTop, rowW, x0;
  while (size > 24) {
    gap = Math.max(4, size * 0.1);
    rowW = n * size + (n - 1) * gap;
    x0 = (W - rowW) / 2;
    slotTop = (H - size) / 2;
    const margin = size * 0.35;
    homes = scatterAround(letterIdx.length, size, W, H, pad, {
      left: x0 - margin,
      right: x0 + rowW + margin,
      top: slotTop - margin,
      bottom: slotTop + size + margin,
    });
    if (homes) break;
    size *= 0.92;
  }
  size = Math.floor(size);
  if (!homes) homes = letterIdx.map((_, k) => ({ x: pad + (k % 10) * size, y: H - size - 12 }));

  const slots = chars.map((_, i) => ({ x: x0 + i * (size + gap), y: slotTop }));
  return { size, slots, homes, letterIdx };
}

// ---------- Draggable letter ----------
function LetterTile({ tile, size, locked, active, onGrab, onRelease }) {
  const cb = useRef({});
  cb.current = { onGrab, onRelease, locked };
  const start = useRef({ x: 0, y: 0 });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        tile.pos.stopAnimation((v) => {
          start.current = v;
        });
        cb.current.onGrab(tile.id);
      },
      onPanResponderMove: (_, g) => {
        if (cb.current.locked) return;
        tile.pos.setValue({ x: start.current.x + g.dx, y: start.current.y + g.dy });
      },
      onPanResponderRelease: (_, g) =>
        cb.current.onRelease(tile.id, start.current.x + g.dx, start.current.y + g.dy),
      onPanResponderTerminate: (_, g) =>
        cb.current.onRelease(tile.id, start.current.x + g.dx, start.current.y + g.dy),
    })
  ).current;

  const rotate = tile.rot.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });
  const z = active ? 100 : locked ? 2 : 10;
  const edge = Math.max(4, Math.round(size * 0.07));

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.24,
          backgroundColor: tile.color.bg,
          borderBottomWidth: edge,
          borderBottomColor: tile.color.edge,
          zIndex: z,
          elevation: active ? 12 : locked ? 1 : 4,
          transform: [
            { translateX: tile.pos.x },
            { translateY: Animated.add(tile.pos.y, tile.hop) },
            { scale: tile.scale },
            { rotate },
          ],
        },
      ]}
    >
      <Text allowFontScaling={false} style={[styles.tileText, { fontSize: size * 0.62, color: tile.color.fg }]}>
        {tile.ch}
      </Text>
    </Animated.View>
  );
}

// ---------- Shared: spell it out loud, then say the name ----------
function spellAndSay(letters, spoken, onLetter, onName) {
  Speech.stop();
  letters.forEach((ch, k) => {
    Speech.speak(letterSound(ch), speakOpts({ onStart: () => onLetter(k) }));
  });
  Speech.speak(spoken, speakOpts({ rate: 0.75, onStart: onName }));
}

// ---------- Shared: the "You did it!" card ----------
function FinishCard({ anim, done, lead, name, actions }) {
  return (
    <Animated.View
      pointerEvents={done ? 'box-none' : 'none'}
      style={[
        styles.bannerWrap,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
        },
      ]}
    >
      <View style={styles.banner}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.bannerSmall}>{lead}</Text>
          <Text style={styles.bannerName} numberOfLines={1} adjustsFontSizeToFit>
            {name}!
          </Text>
        </View>
        <View style={styles.bannerRow}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed }) => [a.primary ? styles.bigBtn : styles.softBtn, pressed && styles.pressed]}
            >
              <Text style={a.primary ? styles.bigBtnText : styles.softBtnText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

// =====================================================================
// LEVEL 1: Build it — drag the scrambled letters into place
// =====================================================================
function BuildLevel({ chars, spoken, hints, onNext }) {
  const [board, setBoard] = useState(null);
  const [round, setRound] = useState(0);
  const [placed, setPlaced] = useState({});
  const placedRef = useRef({});
  const [activeId, setActiveId] = useState(null);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const banner = useRef(new Animated.Value(0)).current;
  const timers = useRef([]);

  const displayName = chars.map((c) => c.ch).join('');
  const letterCount = chars.filter((c) => !c.fixed).length;

  const layout = useMemo(
    () => (board ? computeLayout(board.w, board.h, chars) : null),
    // round is here on purpose: a new round reshuffles the letters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, chars, round]
  );

  const tiles = useMemo(() => {
    if (!layout) return [];
    const colors = shuffle(TILE_COLORS);
    return layout.letterIdx.map((charIndex, k) => {
      const home = layout.homes[k];
      const homeRot = Math.random() * 16 - 8;
      return {
        id: k,
        ch: chars[charIndex].ch,
        color: colors[k % colors.length],
        home,
        homeRot,
        pos: new Animated.ValueXY(home),
        scale: new Animated.Value(1),
        rot: new Animated.Value(homeRot),
        hop: new Animated.Value(0),
      };
    });
  }, [layout, chars]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const resetRound = () => {
    clearTimers();
    Speech.stop();
    placedRef.current = {};
    setPlaced({});
    doneRef.current = false;
    setDone(false);
    banner.setValue(0);
    setActiveId(null);
  };

  useEffect(
    () => () => {
      clearTimers();
      Speech.stop();
    },
    []
  );

  const onBoardLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (!board || Math.abs(board.w - width) > 1 || Math.abs(board.h - height) > 1) {
      resetRound();
      setBoard({ w: width, h: height });
    }
  };

  const hop = (tid, height = 18) => {
    const t = tiles[tid];
    if (!t) return;
    Animated.sequence([
      Animated.timing(t.hop, { toValue: -height, duration: 140, useNativeDriver: false }),
      Animated.spring(t.hop, { toValue: 0, friction: 3, tension: 120, useNativeDriver: false }),
    ]).start();
  };

  const showBanner = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    Animated.spring(banner, { toValue: 1, friction: 6, useNativeDriver: false }).start();
  };

  // Spell it out letter by letter (each tile hops as it's said), then say the name.
  const celebrate = () => {
    const slotToTile = {};
    Object.entries(placedRef.current).forEach(([tid, s]) => {
      slotToTile[s] = Number(tid);
    });
    const order = chars.map((c, i) => (c.fixed ? null : slotToTile[i])).filter((v) => v != null);
    spellAndSay(
      order.map((tid) => tiles[tid].ch),
      spoken,
      (k) => hop(order[k]),
      () => {
        order.forEach((tid, k) => timers.current.push(setTimeout(() => hop(tid, 26), k * 70)));
        showBanner();
      }
    );
    // If the device doesn't report speech progress, still show the finish card.
    timers.current.push(setTimeout(showBanner, 1500 + order.length * 900));
  };

  const handleGrab = (id) => {
    const t = tiles[id];
    if (!t) return;
    sayLetter(t.ch);
    setActiveId(id);
    if (id in placedRef.current) {
      Animated.sequence([
        Animated.timing(t.scale, { toValue: 1.12, duration: 90, useNativeDriver: false }),
        Animated.spring(t.scale, { toValue: 1, friction: 4, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(t.scale, { toValue: 1.18, friction: 5, useNativeDriver: false }),
        Animated.timing(t.rot, { toValue: 0, duration: 120, useNativeDriver: false }),
      ]).start();
    }
  };

  const handleRelease = (id, x, y) => {
    const t = tiles[id];
    if (!t || !layout) return;
    if (id in placedRef.current) {
      setActiveId(null);
      return;
    }
    const { size, slots } = layout;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const filled = new Set(Object.values(placedRef.current));

    // Closest empty slot that wants this exact letter (capital A only fits a capital A).
    let best = null;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      if (chars[i].fixed || filled.has(i) || chars[i].ch !== t.ch) return;
      const d = Math.hypot(cx - (s.x + size / 2), cy - (s.y + size / 2));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });

    if (best !== null && bestD < size * 0.85) {
      const s = slots[best];
      Animated.parallel([
        Animated.spring(t.pos, { toValue: { x: s.x, y: s.y }, friction: 6, tension: 90, useNativeDriver: false }),
        Animated.spring(t.scale, { toValue: 1, friction: 5, useNativeDriver: false }),
      ]).start(() => setActiveId((a) => (a === id ? null : a)));
      const next = { ...placedRef.current, [id]: best };
      placedRef.current = next;
      setPlaced(next);
      if (Object.keys(next).length === letterCount) {
        timers.current.push(setTimeout(celebrate, 500));
      }
    } else {
      // Not a match: float back home, no scolding.
      Animated.parallel([
        Animated.spring(t.pos, { toValue: t.home, friction: 6, tension: 60, useNativeDriver: false }),
        Animated.spring(t.scale, { toValue: 1, friction: 5, useNativeDriver: false }),
        Animated.timing(t.rot, { toValue: t.homeRot, duration: 250, useNativeDriver: false }),
      ]).start(() => setActiveId((a) => (a === id ? null : a)));
    }
  };

  const filledSlots = new Set(Object.values(placed));

  return (
    <View style={styles.board} onLayout={onBoardLayout}>
      {layout &&
        layout.slots.map((s, i) => {
          const c = chars[i];
          if (c.fixed) {
            return (
              <View
                key={`slot-${i}`}
                style={[styles.fixedSlot, { left: s.x, top: s.y, width: layout.size, height: layout.size }]}
              >
                <Text allowFontScaling={false} style={[styles.fixedText, { fontSize: layout.size * 0.62 }]}>
                  {c.ch === ' ' ? '' : c.ch}
                </Text>
              </View>
            );
          }
          return (
            <View
              key={`slot-${i}`}
              style={[
                styles.slot,
                {
                  left: s.x,
                  top: s.y,
                  width: layout.size,
                  height: layout.size,
                  borderRadius: layout.size * 0.24,
                  borderWidth: Math.max(2, layout.size * 0.035),
                  borderStyle: filledSlots.has(i) ? 'solid' : 'dashed',
                },
              ]}
            >
              {hints && (
                <Text allowFontScaling={false} style={[styles.ghost, { fontSize: layout.size * 0.62 }]}>
                  {c.ch}
                </Text>
              )}
            </View>
          );
        })}

      {layout &&
        tiles.map((t) => (
          <LetterTile
            key={`r${round}-t${t.id}`}
            tile={t}
            size={layout.size}
            locked={t.id in placed}
            active={activeId === t.id}
            onGrab={handleGrab}
            onRelease={handleRelease}
          />
        ))}

      <FinishCard
        anim={banner}
        done={done}
        lead="You spelled"
        name={displayName}
        actions={[
          { label: '🔊 Say it', onPress: () => sayWords(spoken) },
          {
            label: 'Play again',
            onPress: () => {
              resetRound();
              setRound((r) => r + 1);
            },
          },
          { label: 'Next level  ›', primary: true, onPress: onNext },
        ]}
      />
    </View>
  );
}

// =====================================================================
// LEVEL 2: Dino Dig — the name is buried; rub the dirt away with a shovel
// =====================================================================
const DIRT = {
  earth: '#7A4E31',
  earthDark: '#65402A',
  earthLight: '#8E5D3C',
  floor: '#E6C994',
  floorEdge: '#C9A46A',
  clods: ['#9A6842', '#8B5B39', '#A8774E', '#93633F', '#855535'],
  speck: '#6E4528',
  bone: '#FBF3DD',
  boneShadow: '#6B4A2B',
  pebble: '#A99F90',
  hint: '#FFF4D6',
};

// Smooth native animations on phones; the web preview doesn't support them.
const ND = Platform.OS !== 'web';

const LETTER_UNCOVER = 0.55; // how much of a letter's dirt must be cleared before it pops out

function computeDigLayout(W, H, chars) {
  const pad = 24;
  const n = chars.length;
  const size = Math.floor(Math.min(200, H * 0.4, (W - pad * 2) / (n + (n - 1) * 0.14)));
  const gap = Math.max(4, size * 0.14);
  const rowW = n * size + (n - 1) * gap;
  const x0 = (W - rowW) / 2;
  const y0 = (H - size) / 2 - H * 0.03;

  const glyphs = chars.map((c, i) => ({ ch: c.ch, fixed: c.fixed, x: x0 + i * (size + gap), y: y0, li: -1 }));
  const letters = [];
  glyphs.forEach((g) => {
    if (!g.fixed) {
      g.li = letters.length;
      letters.push({ ch: g.ch, x: g.x, y: g.y, cells: [] });
    }
  });

  // The dig pit: a band of loose dirt clods over the buried name.
  const band = {
    left: Math.max(6, x0 - size * 0.45),
    right: Math.min(W - 6, x0 + rowW + size * 0.45),
    top: Math.max(6, y0 - size * 0.45),
    bottom: Math.min(H - 6, y0 + size * 1.45),
  };
  let cell = Math.max(20, Math.min(44, size / 3.2));
  let cols, rows;
  for (;;) {
    cols = Math.ceil((band.right - band.left) / cell);
    rows = Math.ceil((band.bottom - band.top) / cell);
    if (cols * rows <= 420) break;
    cell *= 1.1;
  }
  const cw = (band.right - band.left) / cols;
  const chh = (band.bottom - band.top) / rows;
  const inset = Math.min(cw, chh) * 0.25;

  const cells = [];
  const cellLetter = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = band.left + (c + 0.5) * cw;
      const cy = band.top + (r + 0.5) * chh;
      let li = -1;
      letters.forEach((L, k) => {
        if (cx > L.x - inset && cx < L.x + size + inset && cy > L.y - inset && cy < L.y + size + inset) li = k;
      });
      if (li >= 0) letters[li].cells.push(cells.length);
      cellLetter.push(li);
      cells.push({
        cx,
        cy,
        shade: DIRT.clods[Math.floor(Math.random() * DIRT.clods.length)],
        rot: Math.random() * 40 - 20,
        dir: Math.random() < 0.5 ? -1 : 1,
        speck: Math.random() < 0.3,
      });
    }
  }

  // Pebbles and little bones scattered in the earth around the pit.
  const decor = [];
  for (let tries = 0; tries < 120 && decor.length < 18; tries++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    if (x > band.left - 20 && x < band.right + 20 && y > band.top - 20 && y < band.bottom + 20) continue;
    if (x > W - 170 && y > H - 150) continue; // keep the shovel's corner clear
    decor.push({ x, y, bone: decor.length % 4 === 0, s: 6 + Math.random() * 10, rot: Math.random() * 180 });
  }

  return {
    size,
    glyphs,
    letters,
    band,
    cols,
    rows,
    cw,
    chh,
    cells,
    cellLetter,
    decor,
    clod: Math.max(cw, chh) * 1.22,
    shovelSize: Math.max(90, Math.min(150, size * 1.15)),
  };
}

// A little cartoon shovel. The blade tip sits exactly at the middle of this view,
// so it can be placed (and wiggle) right under the child's finger.
function ShovelArt({ size }) {
  const gripH = size * 0.09;
  const handleH = size * 0.62;
  const bladeH = size * 0.42;
  const bladeW = size * 0.38;
  const total = gripH + handleH + bladeH;
  return (
    <View pointerEvents="none" style={{ width: size * 0.5, height: total * 2, alignItems: 'center' }}>
      <View style={{ width: size * 0.3, height: gripH, backgroundColor: '#5A341C', borderRadius: gripH / 2 }} />
      <View style={{ width: size * 0.1, height: handleH, backgroundColor: '#C27C3E', borderRadius: size * 0.05, marginTop: -1 }} />
      <View
        style={{
          width: bladeW,
          height: bladeH,
          marginTop: -2,
          backgroundColor: '#BAC4CD',
          borderWidth: 3,
          borderColor: '#76838F',
          borderTopLeftRadius: bladeW * 0.18,
          borderTopRightRadius: bladeW * 0.18,
          borderBottomLeftRadius: bladeW * 0.5,
          borderBottomRightRadius: bladeW * 0.5,
        }}
      />
    </View>
  );
}

function DigLevel({ chars, spoken, onNext }) {
  const [board, setBoard] = useState(null);
  const [round, setRound] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const banner = useRef(new Animated.Value(0)).current;
  const timers = useRef([]);
  const shovelPos = useRef(new Animated.ValueXY({ x: -999, y: -999 })).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const wiggleLoop = useRef(null);
  const hintPulse = useRef(new Animated.Value(0)).current;
  const origin = useRef({ x: 0, y: 0 });
  const last = useRef(null);

  const displayName = chars.map((c) => c.ch).join('');

  const L = useMemo(
    () => (board ? computeDigLayout(board.w, board.h, chars) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, chars, round]
  );

  // Animation values plus the dig progress for this round.
  const A = useMemo(() => {
    if (!L) return null;
    return {
      cells: L.cells.map(() => new Animated.Value(1)),
      letters: L.letters.map(() => ({ reveal: new Animated.Value(0), hop: new Animated.Value(0) })),
      cleared: new Uint8Array(L.cells.length),
      count: L.letters.map(() => 0),
      revealed: L.letters.map(() => false),
      revealedN: 0,
    };
  }, [L]);

  const colors = useMemo(() => shuffle(TILE_COLORS), [round]);

  useEffect(() => {
    if (L && board) shovelPos.setValue({ x: board.w - L.shovelSize * 0.55, y: board.h - 18 });
  }, [L, board, shovelPos]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hintPulse, { toValue: 1, duration: 700, useNativeDriver: ND }),
        Animated.timing(hintPulse, { toValue: 0, duration: 700, useNativeDriver: ND }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      timers.current.forEach(clearTimeout);
      Speech.stop();
    };
  }, [hintPulse]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const resetRound = () => {
    clearTimers();
    Speech.stop();
    doneRef.current = false;
    setDone(false);
    banner.setValue(0);
  };

  const onBoardLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (!board || Math.abs(board.w - width) > 1 || Math.abs(board.h - height) > 1) {
      resetRound();
      setBoard({ w: width, h: height });
    }
  };

  const hop = (li, height = 18) => {
    const v = A && A.letters[li];
    if (!v) return;
    Animated.sequence([
      Animated.timing(v.hop, { toValue: -height, duration: 140, useNativeDriver: ND }),
      Animated.spring(v.hop, { toValue: 0, friction: 3, tension: 120, useNativeDriver: ND }),
    ]).start();
  };

  const showBanner = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    Animated.spring(banner, { toValue: 1, friction: 6, useNativeDriver: false }).start();
  };

  const clearCell = (i) => {
    if (!A || A.cleared[i]) return;
    A.cleared[i] = 1;
    Animated.timing(A.cells[i], { toValue: 0, duration: 260, useNativeDriver: ND }).start();
    const li = L.cellLetter[i];
    if (li >= 0 && !A.revealed[li]) {
      A.count[li] += 1;
      if (A.count[li] >= Math.ceil(L.letters[li].cells.length * LETTER_UNCOVER)) revealLetter(li);
    }
  };

  const revealLetter = (li) => {
    A.revealed[li] = true;
    A.revealedN += 1;
    // Brush the last bits of dirt off this letter.
    L.letters[li].cells.forEach((ci, k) => timers.current.push(setTimeout(() => clearCell(ci), 40 + k * 15)));
    sayLetter(L.letters[li].ch);
    Animated.spring(A.letters[li].reveal, { toValue: 1, friction: 5, tension: 80, useNativeDriver: ND }).start();
    hop(li, 22);
    if (A.revealedN === L.letters.length) timers.current.push(setTimeout(celebrate, 800));
  };

  const celebrate = () => {
    // Sweep away all remaining dirt so the whole name shines.
    let k = 0;
    L.cells.forEach((_, i) => {
      if (!A.cleared[i]) timers.current.push(setTimeout(() => clearCell(i), (k++ % 60) * 12));
    });
    spellAndSay(
      L.letters.map((l) => l.ch),
      spoken,
      (k2) => hop(k2),
      () => {
        L.letters.forEach((_, li) => timers.current.push(setTimeout(() => hop(li, 28), li * 70)));
        showBanner();
      }
    );
    timers.current.push(setTimeout(showBanner, 1500 + L.letters.length * 900));
  };

  const digAt = (x, y) => {
    if (!L) return;
    const { band, cw, chh, cols, rows, cells } = L;
    const r = Math.max(cw, chh) * 0.95;
    const c0 = Math.max(0, Math.floor((x - r - band.left) / cw));
    const c1 = Math.min(cols - 1, Math.floor((x + r - band.left) / cw));
    const r0 = Math.max(0, Math.floor((y - r - band.top) / chh));
    const r1 = Math.min(rows - 1, Math.floor((y + r - band.top) / chh));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const i = rr * cols + cc;
        if (Math.hypot(cells[i].cx - x, cells[i].cy - y) <= r) clearCell(i);
      }
    }
  };

  const handlers = useRef({});
  handlers.current = {
    start: (ne) => {
      origin.current = { x: ne.pageX - ne.locationX, y: ne.pageY - ne.locationY };
      const p = { x: ne.locationX, y: ne.locationY };
      if (!started) setStarted(true);
      shovelPos.setValue(p);
      wiggleLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(wiggle, { toValue: 1, duration: 90, useNativeDriver: false }),
          Animated.timing(wiggle, { toValue: -1, duration: 90, useNativeDriver: false }),
        ])
      );
      wiggleLoop.current.start();
      // Tapping a letter that's already dug up says it again.
      if (L && A) {
        L.letters.forEach((l, li) => {
          if (A.revealed[li] && p.x > l.x && p.x < l.x + L.size && p.y > l.y && p.y < l.y + L.size) {
            sayLetter(l.ch);
            hop(li, 14);
          }
        });
      }
      digAt(p.x, p.y);
      last.current = p;
    },
    move: (ne) => {
      const p = { x: ne.pageX - origin.current.x, y: ne.pageY - origin.current.y };
      shovelPos.setValue(p);
      const prev = last.current || p;
      const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
      const step = L ? Math.min(L.cw, L.chh) * 0.5 : 10;
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let s = 1; s <= steps; s++) {
        digAt(prev.x + ((p.x - prev.x) * s) / steps, prev.y + ((p.y - prev.y) * s) / steps);
      }
      last.current = p;
    },
    end: () => {
      if (wiggleLoop.current) wiggleLoop.current.stop();
      Animated.spring(wiggle, { toValue: 0, friction: 4, useNativeDriver: false }).start();
      last.current = null;
    },
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => handlers.current.start(e.nativeEvent),
      onPanResponderMove: (e) => handlers.current.move(e.nativeEvent),
      onPanResponderRelease: () => handlers.current.end(),
      onPanResponderTerminate: () => handlers.current.end(),
    })
  ).current;

  const shovelTotal = L ? L.shovelSize * (0.09 + 0.62 + 0.42) : 0;
  const shovelRotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['18deg', '40deg'] });

  return (
    <View style={[styles.board, { backgroundColor: DIRT.earth }]} onLayout={onBoardLayout}>
      {/* Everything inside ignores touches; the board itself handles digging. */}
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* rock layers */}
          <View style={[styles.stratum, { top: '10%', height: 10, backgroundColor: DIRT.earthDark }]} />
          <View style={[styles.stratum, { top: '16%', height: 5, backgroundColor: DIRT.earthLight }]} />
          <View style={[styles.stratum, { top: '84%', height: 8, backgroundColor: DIRT.earthLight }]} />
          <View style={[styles.stratum, { top: '90%', height: 12, backgroundColor: DIRT.earthDark }]} />

          {L &&
            L.decor.map((d, i) =>
              d.bone ? (
                <View
                  key={`d${i}`}
                  style={[styles.miniBone, { left: d.x, top: d.y, width: d.s * 2.4, height: d.s * 0.7, transform: [{ rotate: `${d.rot}deg` }] }]}
                />
              ) : (
                <View
                  key={`d${i}`}
                  style={{ position: 'absolute', left: d.x, top: d.y, width: d.s, height: d.s * 0.8, borderRadius: d.s, backgroundColor: DIRT.pebble, opacity: 0.7 }}
                />
              )
            )}

          {L && (
            <View
              style={[
                styles.pit,
                {
                  left: L.band.left,
                  top: L.band.top,
                  width: L.band.right - L.band.left,
                  height: L.band.bottom - L.band.top,
                  borderRadius: L.size * 0.25,
                },
              ]}
            />
          )}

          {/* The buried name: bone-colored fossil letters that turn into bright tiles when dug up */}
          {L &&
            A &&
            L.glyphs.map((g, i) => {
              if (g.fixed) {
                return (
                  <View key={`g${i}`} style={[styles.fixedSlot, { left: g.x, top: g.y, width: L.size, height: L.size }]}>
                    <Text allowFontScaling={false} style={[styles.fixedText, { fontSize: L.size * 0.62, color: DIRT.boneShadow }]}>
                      {g.ch === ' ' ? '' : g.ch}
                    </Text>
                  </View>
                );
              }
              const v = A.letters[g.li];
              const col = colors[g.li % colors.length];
              return (
                <Animated.View
                  key={`g${i}`}
                  style={{
                    position: 'absolute',
                    left: g.x,
                    top: g.y,
                    width: L.size,
                    height: L.size,
                    transform: [{ translateY: v.hop }],
                  }}
                >
                  <View style={styles.fossil}>
                    <Text allowFontScaling={false} style={[styles.fossilText, { fontSize: L.size * 0.66 }]}>
                      {g.ch}
                    </Text>
                  </View>
                  <Animated.View
                    style={[
                      styles.tile,
                      {
                        width: L.size,
                        height: L.size,
                        borderRadius: L.size * 0.24,
                        backgroundColor: col.bg,
                        borderBottomWidth: Math.max(4, Math.round(L.size * 0.07)),
                        borderBottomColor: col.edge,
                        opacity: v.reveal,
                        transform: [{ scale: v.reveal.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
                      },
                    ]}
                  >
                    <Text allowFontScaling={false} style={[styles.tileText, { fontSize: L.size * 0.62, color: col.fg }]}>
                      {g.ch}
                    </Text>
                  </Animated.View>
                </Animated.View>
              );
            })}

          {/* Loose dirt clods on top */}
          {L &&
            A &&
            L.cells.map((c, i) => {
              const v = A.cells[i];
              return (
                <Animated.View
                  key={`c${round}-${i}`}
                  style={{
                    position: 'absolute',
                    left: c.cx - L.clod / 2,
                    top: c.cy - L.clod / 2,
                    width: L.clod,
                    height: L.clod,
                    borderRadius: L.clod * 0.38,
                    backgroundColor: c.shade,
                    opacity: v,
                    transform: [
                      { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [c.dir * L.clod * 0.7, 0] }) },
                      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-L.clod * 0.9, 0] }) },
                      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                      { rotate: `${c.rot}deg` },
                    ],
                  }}
                >
                  {c.speck && (
                    <View
                      style={{
                        position: 'absolute',
                        left: L.clod * 0.25,
                        top: L.clod * 0.3,
                        width: L.clod * 0.18,
                        height: L.clod * 0.14,
                        borderRadius: L.clod,
                        backgroundColor: DIRT.speck,
                      }}
                    />
                  )}
                </Animated.View>
              );
            })}

          {/* The shovel follows the child's finger */}
          {L && (
            <Animated.View
              style={{
                position: 'absolute',
                left: -(L.shovelSize * 0.25),
                top: -shovelTotal,
                transform: [{ translateX: shovelPos.x }, { translateY: shovelPos.y }, { rotate: shovelRotate }],
                zIndex: 50,
                elevation: 10,
              }}
            >
              <ShovelArt size={L.shovelSize} />
            </Animated.View>
          )}

          {!started && (
            <Animated.View
              style={[
                styles.digHint,
                { transform: [{ scale: hintPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] },
              ]}
            >
              <Text style={styles.digHintText}>Rub the dirt to dig up your name!</Text>
            </Animated.View>
          )}
        </View>
      </View>

      <FinishCard
        anim={banner}
        done={done}
        lead="You dug up"
        name={displayName}
        actions={[
          { label: '🔊 Say it', onPress: () => sayWords(spoken) },
          {
            label: 'Dig again',
            onPress: () => {
              resetRound();
              setRound((r) => r + 1);
            },
          },
          { label: 'Next level  ›', primary: true, onPress: onNext },
        ]}
      />
    </View>
  );
}

// =====================================================================
// LEVEL 3: Sand Trace — write the name in the sand at the beach
// =====================================================================
const BEACH = {
  sea: '#3FB4DF',
  seaLight: '#7FD3EE',
  foam: '#FFFFFF',
  sand: '#F4DCA8',
  speck: '#E2C285',
  groove: '#E3C07F',
  grooveDots: '#C49A55',
  lines: '#DDBB7A',
  wet: '#B5844A',
  start: '#34C38F',
  ink: '#7A5530',
  hint: '#FFF6E0',
};

// Handwriting letters, drawn the way kids are taught (ball-and-stick print),
// stroke by stroke in teaching order.
// Units: 0 = top of capitals and tall letters, 0.5 = top of small letters,
// 1 = the line letters sit on, 1.4 = bottom of tails (g, j, p, q, y).
const ln = (...pts) => pts;
const dot = (x, y) => [[x, y]];
const st = (...segs) => segs.flat();
function arc(cx, cy, rx, ry, a0, a1) {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 10));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const GLYPHS = {
  A: { w: 0.8, s: [ln([0.4, 0], [0, 1]), ln([0.4, 0], [0.8, 1]), ln([0.16, 0.62], [0.64, 0.62])] },
  B: {
    w: 0.65,
    s: [
      ln([0, 0], [0, 1]),
      st(ln([0, 0], [0.35, 0]), arc(0.35, 0.25, 0.25, 0.25, -90, 90), ln([0.35, 0.5], [0, 0.5])),
      st(ln([0, 0.5], [0.38, 0.5]), arc(0.38, 0.75, 0.25, 0.25, -90, 90), ln([0.38, 1], [0, 1])),
    ],
  },
  C: { w: 0.86, s: [arc(0.5, 0.5, 0.5, 0.5, -45, -315)] },
  D: { w: 0.75, s: [ln([0, 0], [0, 1]), st(ln([0, 0], [0.25, 0]), arc(0.25, 0.5, 0.5, 0.5, -90, 90), ln([0.25, 1], [0, 1]))] },
  E: { w: 0.6, s: [ln([0, 0], [0, 1]), ln([0, 0], [0.6, 0]), ln([0, 0.5], [0.5, 0.5]), ln([0, 1], [0.6, 1])] },
  F: { w: 0.6, s: [ln([0, 0], [0, 1]), ln([0, 0], [0.6, 0]), ln([0, 0.5], [0.5, 0.5])] },
  G: { w: 1, s: [st(arc(0.5, 0.5, 0.5, 0.5, -45, -360), ln([1, 0.5], [0.6, 0.5]))] },
  H: { w: 0.7, s: [ln([0, 0], [0, 1]), ln([0.7, 0], [0.7, 1]), ln([0, 0.5], [0.7, 0.5])] },
  I: { w: 0.5, s: [ln([0.25, 0], [0.25, 1]), ln([0, 0], [0.5, 0]), ln([0, 1], [0.5, 1])] },
  J: { w: 0.6, s: [st(ln([0.55, 0], [0.55, 0.72]), arc(0.29, 0.72, 0.26, 0.26, 0, 180))] },
  K: { w: 0.65, s: [ln([0, 0], [0, 1]), ln([0.65, 0], [0, 0.58]), ln([0.2, 0.42], [0.65, 1])] },
  L: { w: 0.55, s: [ln([0, 0], [0, 1], [0.55, 1])] },
  M: { w: 0.9, s: [ln([0, 0], [0, 1]), ln([0, 0], [0.45, 0.75], [0.9, 0], [0.9, 1])] },
  N: { w: 0.75, s: [ln([0, 0], [0, 1]), ln([0, 0], [0.75, 1], [0.75, 0])] },
  O: { w: 1, s: [arc(0.5, 0.5, 0.5, 0.5, -90, -450)] },
  P: { w: 0.62, s: [ln([0, 0], [0, 1]), st(ln([0, 0], [0.37, 0]), arc(0.37, 0.25, 0.25, 0.25, -90, 90), ln([0.37, 0.5], [0, 0.5]))] },
  Q: { w: 1, s: [arc(0.5, 0.5, 0.5, 0.5, -90, -450), ln([0.62, 0.72], [0.98, 1.05])] },
  R: {
    w: 0.65,
    s: [
      ln([0, 0], [0, 1]),
      st(ln([0, 0], [0.37, 0]), arc(0.37, 0.25, 0.25, 0.25, -90, 90), ln([0.37, 0.5], [0, 0.5])),
      ln([0.3, 0.5], [0.65, 1]),
    ],
  },
  S: { w: 0.66, s: [st(arc(0.33, 0.25, 0.3, 0.25, -20, -270), arc(0.33, 0.75, 0.3, 0.25, -90, 160))] },
  T: { w: 0.7, s: [ln([0.35, 0], [0.35, 1]), ln([0, 0], [0.7, 0])] },
  U: { w: 0.7, s: [st(ln([0, 0], [0, 0.65]), arc(0.35, 0.65, 0.35, 0.35, 180, 0), ln([0.7, 0.65], [0.7, 0]))] },
  V: { w: 0.7, s: [ln([0, 0], [0.35, 1], [0.7, 0])] },
  W: { w: 1, s: [ln([0, 0], [0.25, 1], [0.5, 0.3], [0.75, 1], [1, 0])] },
  X: { w: 0.7, s: [ln([0, 0], [0.7, 1]), ln([0.7, 0], [0, 1])] },
  Y: { w: 0.7, s: [ln([0, 0], [0.35, 0.5]), ln([0.7, 0], [0.35, 0.5], [0.35, 1])] },
  Z: { w: 0.65, s: [ln([0, 0], [0.65, 0], [0, 1], [0.65, 1])] },

  a: { w: 0.5, s: [arc(0.25, 0.75, 0.25, 0.25, -10, -370), ln([0.5, 0.5], [0.5, 1])] },
  b: { w: 0.5, s: [ln([0, 0], [0, 1]), arc(0.25, 0.75, 0.25, 0.25, 180, 540)] },
  c: { w: 0.47, s: [arc(0.25, 0.75, 0.25, 0.25, -40, -320)] },
  d: { w: 0.5, s: [arc(0.25, 0.75, 0.25, 0.25, -10, -370), ln([0.5, 0], [0.5, 1])] },
  e: { w: 0.5, s: [st(ln([0.01, 0.75], [0.5, 0.75]), arc(0.25, 0.75, 0.25, 0.25, 0, -315))] },
  f: { w: 0.45, s: [st(arc(0.35, 0.15, 0.15, 0.15, -20, -180), ln([0.2, 0.15], [0.2, 1])), ln([0, 0.5], [0.42, 0.5])] },
  g: { w: 0.5, s: [arc(0.25, 0.75, 0.25, 0.25, -10, -370), st(ln([0.5, 0.5], [0.5, 1.2]), arc(0.27, 1.2, 0.23, 0.2, 0, 160))] },
  h: { w: 0.5, s: [ln([0, 0], [0, 1]), st(arc(0.25, 0.72, 0.25, 0.22, 180, 360), ln([0.5, 0.72], [0.5, 1]))] },
  i: { w: 0.1, s: [ln([0.05, 0.5], [0.05, 1]), dot(0.05, 0.3)] },
  j: { w: 0.35, s: [st(ln([0.32, 0.5], [0.32, 1.2]), arc(0.16, 1.2, 0.16, 0.18, 0, 160)), dot(0.32, 0.3)] },
  k: { w: 0.45, s: [ln([0, 0], [0, 1]), ln([0.42, 0.5], [0, 0.78]), ln([0.15, 0.68], [0.45, 1])] },
  l: { w: 0.1, s: [ln([0.05, 0], [0.05, 1])] },
  m: {
    w: 0.8,
    s: [
      ln([0, 0.5], [0, 1]),
      st(arc(0.2, 0.7, 0.2, 0.2, 180, 360), ln([0.4, 0.7], [0.4, 1])),
      st(arc(0.6, 0.7, 0.2, 0.2, 180, 360), ln([0.8, 0.7], [0.8, 1])),
    ],
  },
  n: { w: 0.5, s: [ln([0, 0.5], [0, 1]), st(arc(0.25, 0.72, 0.25, 0.22, 180, 360), ln([0.5, 0.72], [0.5, 1]))] },
  o: { w: 0.5, s: [arc(0.25, 0.75, 0.25, 0.25, -90, -450)] },
  p: { w: 0.5, s: [ln([0, 0.5], [0, 1.4]), arc(0.25, 0.75, 0.25, 0.25, 180, 540)] },
  q: { w: 0.5, s: [arc(0.25, 0.75, 0.25, 0.25, -10, -370), ln([0.5, 0.5], [0.5, 1.4])] },
  r: { w: 0.4, s: [ln([0, 0.5], [0, 1]), arc(0.22, 0.72, 0.22, 0.2, 180, 320)] },
  s: { w: 0.42, s: [st(arc(0.21, 0.625, 0.19, 0.125, -20, -270), arc(0.21, 0.875, 0.19, 0.125, -90, 160))] },
  t: { w: 0.36, s: [ln([0.15, 0.12], [0.15, 1]), ln([0, 0.5], [0.34, 0.5])] },
  u: { w: 0.5, s: [st(ln([0, 0.5], [0, 0.78]), arc(0.25, 0.78, 0.25, 0.22, 180, 0)), ln([0.5, 0.5], [0.5, 1])] },
  v: { w: 0.5, s: [ln([0, 0.5], [0.25, 1], [0.5, 0.5])] },
  w: { w: 0.72, s: [ln([0, 0.5], [0.18, 1], [0.36, 0.62], [0.54, 1], [0.72, 0.5])] },
  x: { w: 0.45, s: [ln([0, 0.5], [0.45, 1]), ln([0.45, 0.5], [0, 1])] },
  y: { w: 0.5, s: [ln([0, 0.5], [0.25, 1]), ln([0.5, 0.5], [0.05, 1.4])] },
  z: { w: 0.45, s: [ln([0, 0.5], [0.45, 0.5], [0, 1], [0.45, 1])] },
};

const stripAccents = (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '');

function densify(pts, step) {
  if (pts.length === 1) return [pts[0]];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

function pathD(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} L${pts[0][0] + 0.1} ${pts[0][1]}`;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

function computeTraceLayout(W, H, chars) {
  const seaH = Math.round(H * 0.16);
  const gapU = 0.24;
  const items = chars.map((c) => {
    if (c.ch === ' ') return { kind: 'space', w: 0.4 };
    if (c.ch === '-') return { kind: 'dash', w: 0.4 };
    if (c.ch === "'") return { kind: 'apos', w: 0.12 };
    const g = GLYPHS[c.ch] || GLYPHS[stripAccents(c.ch)];
    return g ? { kind: 'glyph', ch: c.ch, g, w: g.w } : { kind: 'space', w: 0.5 };
  });
  const hasTail = items.some((it) => it.kind === 'glyph' && it.g.s.some((s) => s.some((p) => p[1] > 1.1)));
  const Hu = hasTail ? 1.42 : 1.06;
  const Wu = items.reduce((a, it) => a + it.w, 0) + gapU * (items.length - 1);

  const sandTop = seaH + 12;
  const sandH = H - sandTop;
  const s = Math.max(20, Math.min(300, (W - 56) / Wu, (sandH - 64) / Hu));
  const x0 = (W - Wu * s) / 2;
  const y0 = sandTop + (sandH - 52 - Hu * s) / 2 + 4;
  const step = Math.max(4, s * 0.04);

  const letters = [];
  const marks = [];
  let cx = x0;
  items.forEach((it) => {
    const ox = cx;
    if (it.kind === 'glyph') {
      const strokes = it.g.s.map((pts) => {
        const px = pts.map(([x, y]) => [ox + x * s, y0 + y * s]);
        return { pts: px, samples: densify(px, step) };
      });
      const all = strokes.flatMap((k) => k.pts);
      letters.push({
        ch: it.ch,
        strokes,
        box: {
          x1: Math.min(...all.map((p) => p[0])),
          x2: Math.max(...all.map((p) => p[0])),
          y1: Math.min(...all.map((p) => p[1])),
          y2: Math.max(...all.map((p) => p[1])),
        },
        cx: ox + (it.w * s) / 2,
      });
    } else if (it.kind === 'dash') {
      marks.push([[ox + 0.05 * s, y0 + 0.72 * s], [ox + 0.35 * s, y0 + 0.72 * s]]);
    } else if (it.kind === 'apos') {
      marks.push([[ox + 0.06 * s, y0], [ox + 0.06 * s, y0 + 0.18 * s]]);
    }
    cx += (it.w + gapU) * s;
  });

  const specks = Array.from({ length: 60 }, () => ({
    x: Math.random() * W,
    y: sandTop + Math.random() * sandH,
    r: 1 + Math.random() * 2.2,
  }));

  return {
    s,
    seaH,
    letters,
    marks,
    lines: { top: y0, mid: y0 + 0.5 * s, base: y0 + s, x1: 16, x2: W - 16 },
    tol: Math.max(14, s * 0.11), // how close the finger must stay to the line
    groove: Math.max(10, s * 0.15),
    trail: Math.max(7, s * 0.09),
    specks,
  };
}

const TRACE_LETTER_DONE = 0.93; // share of a letter's whole path that must be traced
const TRACE_STROKE_MIN = 0.88; // and every single stroke must be traced nearly end to end

function TraceLevel({ chars, spoken, onBack }) {
  const [board, setBoard] = useState(null);
  const [round, setRound] = useState(0);
  const [, setTick] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const banner = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const foam = useRef(new Animated.Value(0)).current;
  const timers = useRef([]);
  const trails = useRef([]);
  const last = useRef(null);
  const origin = useRef({ x: 0, y: 0 });
  const raf = useRef(null);

  const displayName = chars.map((c) => c.ch).join('');

  const T = useMemo(
    () => (board ? computeTraceLayout(board.w, board.h, chars) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, chars, round]
  );

  const S = useMemo(() => {
    if (!T) return null;
    return {
      hits: T.letters.map((l) => l.strokes.map((k) => new Uint8Array(k.samples.length))),
      counts: T.letters.map((l) => l.strokes.map(() => 0)),
      complete: T.letters.map(() => false),
      completeN: 0,
      pops: T.letters.map(() => new Animated.Value(1)),
    };
  }, [T]);

  const colors = useMemo(() => shuffle(TILE_COLORS), [round]);

  useEffect(() => {
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: ND }),
          Animated.timing(pulse, { toValue: 0, duration: 650, useNativeDriver: ND }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(foam, { toValue: 1, duration: 2200, useNativeDriver: ND }),
          Animated.timing(foam, { toValue: 0, duration: 2200, useNativeDriver: ND }),
        ])
      ),
    ];
    loops.forEach((l) => l.start());
    return () => {
      loops.forEach((l) => l.stop());
      timers.current.forEach(clearTimeout);
      if (raf.current) cancelAnimationFrame(raf.current);
      Speech.stop();
    };
  }, [pulse, foam]);

  const redraw = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      setTick((t) => t + 1);
    });
  };

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const resetRound = () => {
    clearTimers();
    Speech.stop();
    trails.current = [];
    doneRef.current = false;
    setDone(false);
    banner.setValue(0);
  };

  const onBoardLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (!board || Math.abs(board.w - width) > 1 || Math.abs(board.h - height) > 1) {
      resetRound();
      setBoard({ w: width, h: height });
    }
  };

  const pop = (li) => {
    const v = S && S.pops[li];
    if (!v) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: ND }).start();
  };

  const showBanner = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    Animated.spring(banner, { toValue: 1, friction: 6, useNativeDriver: false }).start();
  };

  const celebrate = () => {
    spellAndSay(
      T.letters.map((l) => l.ch),
      spoken,
      (k) => pop(k),
      () => {
        T.letters.forEach((_, li) => timers.current.push(setTimeout(() => pop(li), li * 80)));
        showBanner();
      }
    );
    timers.current.push(setTimeout(showBanner, 1500 + T.letters.length * 900));
  };

  const completeLetter = (li) => {
    S.complete[li] = true;
    S.completeN += 1;
    sayLetter(T.letters[li].ch);
    pop(li);
    redraw();
    if (S.completeN === T.letters.length) timers.current.push(setTimeout(celebrate, 700));
  };

  const markAt = (x, y) => {
    if (!T || !S) return;
    const tol = T.tol;
    T.letters.forEach((l, li) => {
      if (S.complete[li]) return;
      const b = l.box;
      if (x < b.x1 - tol || x > b.x2 + tol || y < b.y1 - tol || y > b.y2 + tol) return;
      let any = false;
      l.strokes.forEach((k, ki) => {
        const h = S.hits[li][ki];
        k.samples.forEach((p, j) => {
          if (!h[j] && Math.abs(p[0] - x) <= tol && Math.abs(p[1] - y) <= tol && Math.hypot(p[0] - x, p[1] - y) <= tol) {
            h[j] = 1;
            S.counts[li][ki] += 1;
            any = true;
          }
        });
      });
      if (!any) return;
      let tot = 0;
      let got = 0;
      let everyStroke = true;
      l.strokes.forEach((k, ki) => {
        tot += k.samples.length;
        got += S.counts[li][ki];
        if (S.counts[li][ki] / k.samples.length < TRACE_STROKE_MIN) everyStroke = false;
      });
      if (everyStroke && got / tot >= TRACE_LETTER_DONE) completeLetter(li);
    });
  };

  const handlers = useRef({});
  handlers.current = {
    start: (ne) => {
      if (!T) return;
      origin.current = { x: ne.pageX - ne.locationX, y: ne.pageY - ne.locationY };
      const p = [ne.locationX, ne.locationY];
      if (!started) setStarted(true);
      // Tapping a finished letter says it again.
      T.letters.forEach((l, li) => {
        const b = l.box;
        if (S.complete[li] && p[0] > b.x1 - T.tol && p[0] < b.x2 + T.tol && p[1] > b.y1 - T.tol && p[1] < b.y2 + T.tol) {
          sayLetter(l.ch);
          pop(li);
        }
      });
      trails.current.push([p]);
      markAt(p[0], p[1]);
      last.current = p;
      redraw();
    },
    move: (ne) => {
      if (!T) return;
      const p = [ne.pageX - origin.current.x, ne.pageY - origin.current.y];
      const prev = last.current || p;
      const dist = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (dist < 2) return;
      const steps = Math.max(1, Math.ceil(dist / (T.tol * 0.5)));
      for (let k = 1; k <= steps; k++) {
        markAt(prev[0] + ((p[0] - prev[0]) * k) / steps, prev[1] + ((p[1] - prev[1]) * k) / steps);
      }
      const trail = trails.current[trails.current.length - 1];
      if (trail) trail.push(p);
      last.current = p;
      redraw();
    },
    end: () => {
      last.current = null;
    },
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => handlers.current.start(e.nativeEvent),
      onPanResponderMove: (e) => handlers.current.move(e.nativeEvent),
      onPanResponderRelease: () => handlers.current.end(),
      onPanResponderTerminate: () => handlers.current.end(),
    })
  ).current;

  // A wave rolls in, smooths the sand, and rolls back out.
  const washAndRestart = () => {
    resetRound();
    Animated.timing(wave, { toValue: 1, duration: 650, useNativeDriver: ND }).start(() => {
      setRound((r) => r + 1);
      Animated.timing(wave, { toValue: 0, duration: 800, delay: 150, useNativeDriver: ND }).start();
    });
  };

  // Where the green "start here" dot goes: the first stroke of the next letter that still needs tracing.
  let startDot = null;
  let current = -1;
  if (T && S) {
    current = S.complete.findIndex((c) => !c);
    if (current >= 0) {
      const l = T.letters[current];
      const ki = l.strokes.findIndex((k, i) => S.counts[current][i] / k.samples.length < TRACE_STROKE_MIN);
      if (ki >= 0) startDot = l.strokes[ki].pts[0];
    }
  }

  const H = board ? board.h : 0;
  const W = board ? board.w : 0;

  return (
    <View style={[styles.board, { backgroundColor: BEACH.sand }]} onLayout={onBoardLayout}>
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {T && (
            <>
              {/* the sea along the top */}
              <View style={[styles.sea, { height: T.seaH }]} />
              <View style={[styles.seaShallow, { top: T.seaH * 0.62, height: T.seaH * 0.38 }]} />
              <Animated.View
                style={[
                  styles.foamRow,
                  {
                    top: T.seaH - 9,
                    transform: [{ translateX: foam.interpolate({ inputRange: [0, 1], outputRange: [-14, 6] }) }],
                  },
                ]}
              >
                {Array.from({ length: Math.ceil(W / 22) + 3 }, (_, i) => (
                  <View key={i} style={styles.foamBubble} />
                ))}
              </Animated.View>

              {T.specks.map((d, i) => (
                <View
                  key={`s${i}`}
                  style={{ position: 'absolute', left: d.x, top: d.y, width: d.r * 2, height: d.r * 2, borderRadius: d.r, backgroundColor: BEACH.speck }}
                />
              ))}

              <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
                {/* handwriting lines drawn in the sand: top line, dashed middle, base line */}
                <Line x1={T.lines.x1} y1={T.lines.top} x2={T.lines.x2} y2={T.lines.top} stroke={BEACH.lines} strokeWidth={2} />
                <Line
                  x1={T.lines.x1}
                  y1={T.lines.mid}
                  x2={T.lines.x2}
                  y2={T.lines.mid}
                  stroke={BEACH.lines}
                  strokeWidth={2}
                  strokeDasharray="10 10"
                />
                <Line x1={T.lines.x1} y1={T.lines.base} x2={T.lines.x2} y2={T.lines.base} stroke={BEACH.lines} strokeWidth={3} />

                {T.marks.map((m, i) => (
                  <Path key={`m${i}`} d={pathD(m)} stroke={BEACH.ink} strokeWidth={T.groove * 0.6} strokeLinecap="round" fill="none" />
                ))}

                {/* letters waiting to be traced: a groove with a dotted guide down the middle */}
                {T.letters.map((l, li) =>
                  S.complete[li]
                    ? null
                    : l.strokes.map((k, ki) => (
                        <G key={`g${li}-${ki}`} opacity={li === current ? 1 : 0.5}>
                          <Path
                            d={pathD(k.pts)}
                            stroke={BEACH.groove}
                            strokeWidth={T.groove}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                          <Path
                            d={pathD(k.pts)}
                            stroke={BEACH.grooveDots}
                            strokeWidth={Math.max(2, T.groove * 0.14)}
                            strokeLinecap="round"
                            strokeDasharray={`0.1 ${Math.max(7, T.groove * 0.55)}`}
                            fill="none"
                          />
                        </G>
                      ))
                )}

                {/* the child's finger marks in the wet sand */}
                {trails.current.map((t, i) => (
                  <Path
                    key={`t${i}`}
                    d={pathD(t)}
                    stroke={BEACH.wet}
                    strokeWidth={T.trail}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    opacity={0.85}
                  />
                ))}

                {/* finished letters, bright and clean on top */}
                {T.letters.map((l, li) =>
                  !S.complete[li]
                    ? null
                    : l.strokes.map((k, ki) => {
                        const col = colors[li % colors.length];
                        return (
                          <G key={`d${li}-${ki}`}>
                            <Path d={pathD(k.pts)} stroke={col.edge} strokeWidth={T.groove + 5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            <Path d={pathD(k.pts)} stroke={col.bg} strokeWidth={T.groove} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </G>
                        );
                      })
                )}
              </Svg>

              {startDot && (
                <Animated.View
                  style={[
                    styles.startDot,
                    {
                      left: startDot[0] - T.groove * 0.75,
                      top: startDot[1] - T.groove * 0.75,
                      width: T.groove * 1.5,
                      height: T.groove * 1.5,
                      borderRadius: T.groove,
                      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.2] }) }],
                    },
                  ]}
                />
              )}

              {/* a star pops above each letter as it's finished */}
              {T.letters.map((l, li) => {
                const v = S.pops[li];
                return (
                  <Animated.Text
                    key={`p${li}`}
                    style={[
                      styles.popStar,
                      {
                        left: l.cx - 18,
                        top: l.box.y1 - 46,
                        opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                        transform: [
                          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, -22] }) },
                          { scale: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1.25, 1] }) },
                        ],
                      },
                    ]}
                  >
                    ⭐
                  </Animated.Text>
                );
              })}

              <Text style={[styles.beachThing, { left: 18, bottom: 10, fontSize: 30 }]}>🐚</Text>
              <Text style={[styles.beachThing, { right: 22, bottom: 12, fontSize: 32 }]}>🦀</Text>

              {!started && (
                <Animated.View
                  style={[
                    styles.digHint,
                    { backgroundColor: BEACH.hint, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }] },
                  ]}
                >
                  <Text style={[styles.digHintText, { color: BEACH.ink }]}>Trace your name in the sand. Start at the green dot!</Text>
                </Animated.View>
              )}
            </>
          )}
        </View>
      </View>

      {/* the wave that washes the sand smooth */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wave,
          {
            height: H + 30,
            transform: [{ translateY: wave.interpolate({ inputRange: [0, 1], outputRange: [-(H + 40), 0] }) }],
          },
        ]}
      >
        <View style={styles.waveFoam}>
          {Array.from({ length: Math.ceil(W / 26) + 2 }, (_, i) => (
            <View key={i} style={styles.waveBubble} />
          ))}
        </View>
      </Animated.View>

      <FinishCard
        anim={banner}
        done={done}
        lead="You wrote"
        name={displayName}
        actions={[
          { label: '🔊 Say it', onPress: () => sayWords(spoken) },
          { label: '‹  Level 1', onPress: onBack },
          { label: 'Write again', primary: true, onPress: washAndRestart },
        ]}
      />
    </View>
  );
}

// ---------- Play screen: top bar + the current level ----------
const LEVELS = [
  { n: 1, label: 'Build', bg: C.mat },
  { n: 2, label: 'Dig', bg: DIRT.earth },
  { n: 3, label: 'Trace', bg: BEACH.sand },
];

function PlayScreen({ chars, spoken, hints, onHome }) {
  const [level, setLevel] = useState(1);
  const go = (n) => {
    Speech.stop();
    setLevel(n);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: LEVELS[level - 1].bg }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.gameBar}>
        <Pressable onPress={onHome} style={({ pressed }) => [styles.barBtn, pressed && styles.pressed]}>
          <Text style={styles.barBtnText}>‹  Home</Text>
        </Pressable>

        <View style={styles.levelTabs}>
          {LEVELS.map((l) => {
            const on = l.n === level;
            return (
              <Pressable
                key={l.n}
                onPress={() => go(l.n)}
                style={({ pressed }) => [styles.levelTab, on && styles.levelTabOn, pressed && styles.pressed]}
              >
                <Text style={[styles.levelTabText, on && styles.levelTabTextOn]}>
                  {l.n} · {l.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => sayWords(spoken)}
          style={({ pressed }) => [styles.barBtn, styles.hearBtn, pressed && styles.pressed]}
        >
          <Text style={[styles.barBtnText, { color: '#fff' }]}>🔊  My name</Text>
        </Pressable>
      </View>

      {level === 1 && <BuildLevel key="build" chars={chars} spoken={spoken} hints={hints} onNext={() => go(2)} />}
      {level === 2 && <DigLevel key="dig" chars={chars} spoken={spoken} onNext={() => go(3)} />}
      {level === 3 && <TraceLevel key="trace" chars={chars} spoken={spoken} onBack={() => go(1)} />}
    </SafeAreaView>
  );
}

// ---------- Home: just for kids ----------
function Home({ settings, onPlay, onSettings }) {
  const chars = normalizeName(settings.name);
  const letters = chars.filter((c) => !c.fixed);
  const ready = letters.length > 0 && letters.length <= MAX_LETTERS;
  const spoken = settings.sayAs.trim() || chars.map((c) => c.ch).join('');
  const [ask, setAsk] = useState(false);
  const bounce = useRef(new Animated.Value(0)).current;
  const hold = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 600, useNativeDriver: ND }),
        Animated.timing(bounce, { toValue: 0, duration: 600, useNativeDriver: ND }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [bounce]);

  const { width, height } = useWindowDimensions();
  const tablet = Math.min(width, height) >= 600;
  const shown = ready ? chars : [{ ch: 'A' }, { ch: 'B' }, { ch: 'C' }];
  const maxTile = tablet ? 104 : 64;
  const tile = Math.min(maxTile, (width * 0.8) / Math.max(4, shown.length));

  const play = () => {
    if (ready) {
      onPlay();
    } else {
      setAsk(true);
      sayWords('Ask a grown-up to set up your name!');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.homeTop}>
        {/* Press and hold, so little fingers don't wander into settings */}
        <Pressable
          onPressIn={() => Animated.timing(hold, { toValue: 1, duration: 1200, useNativeDriver: false }).start()}
          onPressOut={() => Animated.timing(hold, { toValue: 0, duration: 150, useNativeDriver: false }).start()}
          onLongPress={onSettings}
          delayLongPress={1200}
          style={styles.gear}
        >
          <Animated.View
            style={[styles.gearFill, { width: hold.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
          />
          <Text style={styles.gearText}>⚙️  Grown-ups: hold</Text>
        </Pressable>
      </View>

      <View style={styles.homeCenter}>
        <Text style={[styles.homeWordmark, tablet && { fontSize: 30 }]}>That’s Me!</Text>
        <View style={styles.homeTiles}>
          {shown.map((c, i) =>
            c.fixed ? (
              <Text key={i} style={[styles.fixedText, { fontSize: tile * 0.6 }]}>
                {c.ch === ' ' ? '  ' : c.ch}
              </Text>
            ) : (
              <Pressable
                key={i}
                onPress={() => sayLetter(c.ch)}
                style={({ pressed }) => [
                  styles.homeTile,
                  {
                    width: tile,
                    height: tile,
                    borderRadius: tile * 0.24,
                    backgroundColor: TILE_COLORS[i % TILE_COLORS.length].bg,
                    borderBottomColor: TILE_COLORS[i % TILE_COLORS.length].edge,
                    transform: [{ rotate: `${(i % 2 ? 1 : -1) * 4}deg` }, { scale: pressed ? 1.12 : 1 }],
                  },
                ]}
              >
                <Text allowFontScaling={false} style={[styles.tileText, { fontSize: tile * 0.6, color: TILE_COLORS[i % TILE_COLORS.length].fg }]}>
                  {c.ch}
                </Text>
              </Pressable>
            )
          )}
        </View>
        {ready && (
          <Pressable onPress={() => sayWords(spoken)} style={({ pressed }) => [styles.softBtn, pressed && styles.pressed]}>
            <Text style={styles.softBtnText}>🔊  Hi, {chars.map((c) => c.ch).join('')}!</Text>
          </Pressable>
        )}

        <Animated.View style={{ transform: [{ scale: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
          <Pressable onPress={play} style={({ pressed }) => [styles.playBtn, tablet && { paddingVertical: 28, paddingHorizontal: 80 }, pressed && styles.pressed]}>
            <Text style={[styles.playText, tablet && { fontSize: 58 }]}>Let's Play!</Text>
          </Pressable>
        </Animated.View>
      </View>

      {ask && (
        <View style={styles.overlay}>
          <View style={styles.askCard}>
            <Text style={styles.askEmoji}>👋</Text>
            <Text style={styles.askTitle}>Almost ready!</Text>
            <Text style={styles.askBody}>Please have your parent set up “Your Name” in Settings.</Text>
            <View style={styles.bannerRow}>
              <Pressable onPress={() => setAsk(false)} style={({ pressed }) => [styles.softBtn, pressed && styles.pressed]}>
                <Text style={styles.softBtnText}>OK</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAsk(false);
                  onSettings();
                }}
                style={({ pressed }) => [styles.bigBtn, pressed && styles.pressed]}
              >
                <Text style={styles.bigBtnText}>Open Settings</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- Settings: for grown-ups ----------
function Settings({ settings, update, voices, onDone }) {
  const { name, sayAs, hints, voiceId } = settings;
  const chars = normalizeName(name);
  const letters = chars.filter((c) => !c.fixed).length;
  const tooLong = letters > MAX_LETTERS;
  const spoken = sayAs.trim() || chars.map((c) => c.ch).join('');

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.setupWrap} keyboardShouldPersistTaps="handled">
          <View style={styles.setupHead}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.appTitle}>Settings</Text>
              <Text style={styles.appSub}>Changes save on this device automatically.</Text>
            </View>
            <Pressable onPress={onDone} style={({ pressed }) => [styles.startBtn, pressed && styles.pressed]}>
              <Text style={styles.startText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <View style={styles.cols}>
              <View style={styles.col}>
                <Text style={styles.label}>Your child's name</Text>
                <TextInput
                  nativeID="childName"
                  value={name}
                  onChangeText={(v) => update({ name: v })}
                  placeholder="e.g. Emma"
                  placeholderTextColor={C.ghost}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={20}
                  style={styles.input}
                  returnKeyType="done"
                />
                {letters > 0 && (
                  <View style={styles.preview}>
                    {chars.map((c, i) =>
                      c.fixed ? (
                        <Text key={i} style={styles.previewFixed}>
                          {c.ch === ' ' ? '  ' : c.ch}
                        </Text>
                      ) : (
                        <View key={i} style={[styles.previewTile, { backgroundColor: TILE_COLORS[i % TILE_COLORS.length].bg }]}>
                          <Text style={[styles.previewText, { color: TILE_COLORS[i % TILE_COLORS.length].fg }]}>{c.ch}</Text>
                        </View>
                      )
                    )}
                  </View>
                )}
                {tooLong && <Text style={styles.warn}>Up to {MAX_LETTERS} letters fit. Try a first name or nickname.</Text>}
              </View>

              <View style={styles.col}>
                <Text style={styles.label}>How do you say it? (optional)</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    nativeID="sayAs"
                    value={sayAs}
                    onChangeText={(v) => update({ sayAs: v })}
                    placeholder="Spell it how it sounds, like shiv-awn"
                    placeholderTextColor={C.ghost}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, { flex: 1, fontSize: 18 }]}
                  />
                  <Pressable
                    disabled={!letters}
                    onPress={() => sayWords(spoken)}
                    style={({ pressed }) => [styles.softBtn, !letters && { opacity: 0.4 }, pressed && styles.pressed]}
                  >
                    <Text style={styles.softBtnText}>🔊 Hear it</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 22 }]}>Voice</Text>
            {voices.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {voices.map((v) => {
                  const on = v.identifier === voiceId;
                  return (
                    <Pressable
                      key={v.identifier}
                      onPress={() => {
                        chosenVoice = v.identifier;
                        update({ voiceId: v.identifier });
                        sayWords(letters ? `Hi! Let's spell ${spoken}!` : "Hi! Let's spell your name!");
                      }}
                      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{voiceLabel(v)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={styles.switchSub}>Using this device's default voice.</Text>
            )}
            <Text style={[styles.switchSub, { marginTop: 8 }]}>Tap a voice to hear it. The friendliest one is picked to start.</Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchTitle}>Show faint letters in the spaces</Text>
                <Text style={styles.switchSub}>For Level 1. Turn off once they know their name by heart.</Text>
              </View>
              <Switch value={hints} onValueChange={(v) => update({ hints: v })} trackColor={{ true: '#34C38F' }} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------- App ----------
const STORE_KEY = 'thatsMe.settings.v1';
const DEFAULT_SETTINGS = { name: '', sayAs: '', hints: true, voiceId: null };

export default function App() {
  const [screen, setScreen] = useState('home');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [voices, setVoices] = useState([]);

  const update = (patch) => setSettings((s) => ({ ...s, ...patch }));

  useEffect(() => {
    // Sideways play. Does nothing in the web preview, which is already wide.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    // Let the voice play even when an iPhone's ring/silent switch is set to silent.
    Promise.resolve()
      .then(() => setAudioModeAsync({ playsInSilentMode: true }))
      .catch(() => {});

    // Bring back the name and other settings from last time.
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
        } catch (e) {
          // ignore a damaged save
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));

    let alive = true;
    loadVoices().then((list) => alive && setVoices(list));
    return () => {
      alive = false;
    };
  }, []);

  // Save whenever a setting changes.
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings, loaded]);

  // Use the saved voice if this device has it, otherwise the friendliest one.
  useEffect(() => {
    if (!voices.length || !loaded) return;
    const saved = voices.find((v) => v.identifier === settings.voiceId);
    const v = saved || voices[0];
    chosenVoice = v.identifier;
    if (!saved) update({ voiceId: v.identifier });
  }, [voices, loaded, settings.voiceId]);

  const chars = useMemo(() => normalizeName(settings.name), [settings.name]);
  const spoken = settings.sayAs.trim() || chars.map((c) => c.ch).join('');

  let body;
  if (!loaded) {
    body = <View style={styles.screen} />;
  } else if (screen === 'settings') {
    body = <Settings settings={settings} update={update} voices={voices} onDone={() => setScreen('home')} />;
  } else if (screen === 'play' && chars.some((c) => !c.fixed)) {
    body = (
      <PlayScreen
        chars={chars}
        spoken={spoken}
        hints={settings.hints}
        onHome={() => {
          Speech.stop();
          setScreen('home');
        }}
      />
    );
  } else {
    body = (
      <Home
        settings={settings}
        onSettings={() => {
          Speech.stop();
          setScreen('settings');
        }}
        onPlay={() => {
          setScreen('play');
          sayWords(`Let's spell ${spoken}!`);
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      {body}
    </SafeAreaProvider>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.mat },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },

  // setup
  setupWrap: { padding: 20, gap: 16, width: '100%', maxWidth: 900, alignSelf: 'center' },
  setupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  appTitle: { fontSize: 34, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  appSub: { fontSize: 15, color: C.inkSoft, lineHeight: 21, marginTop: 2 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 20 },
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  col: { flexGrow: 1, flexBasis: 280, minWidth: 0 },
  label: { fontSize: 13, fontWeight: '800', color: C.inkSoft, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    borderWidth: 2,
    borderColor: C.slotLine,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 9,
    fontSize: 22,
    fontWeight: '700',
    color: C.ink,
    backgroundColor: C.slotBg,
  },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  preview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center' },
  previewTile: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  previewText: { fontSize: 22, fontWeight: '900' },
  previewFixed: { fontSize: 22, fontWeight: '900', color: C.ink },
  warn: { color: C.goEdge, marginTop: 10, fontSize: 15, fontWeight: '600' },
  chips: { gap: 8, paddingRight: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2, borderColor: C.slotLine, backgroundColor: C.slotBg },
  chipOn: { borderColor: C.blue, backgroundColor: C.blueSoft },
  chipText: { fontSize: 15, fontWeight: '700', color: C.inkSoft },
  chipTextOn: { color: C.blueInk },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  switchTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  switchSub: { fontSize: 14, color: C.inkSoft, marginTop: 2 },
  startBtn: {
    backgroundColor: C.go,
    borderBottomWidth: 6,
    borderBottomColor: C.goEdge,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  startText: { color: '#fff', fontSize: 22, fontWeight: '900' },

  // game
  gameBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  barBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.card },
  hearBtn: { backgroundColor: C.blue },
  barBtnText: { fontSize: 16, fontWeight: '800', color: C.ink },
  board: { flex: 1, overflow: 'hidden' },
  slot: {
    position: 'absolute',
    borderColor: C.slotLine,
    backgroundColor: C.slotBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fixedSlot: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  fixedText: { fontWeight: '900', color: C.ink },
  ghost: { fontWeight: '900', color: C.ghost, opacity: 0.55 },
  tile: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B2A22',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  tileText: { fontWeight: '900', includeFontPadding: false },

  bannerWrap: { position: 'absolute', left: 16, right: 16, bottom: 16, alignItems: 'center', zIndex: 200, elevation: 20 },
  banner: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: C.card,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    shadowColor: '#0B2A22',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  bannerSmall: { fontSize: 16, fontWeight: '700', color: C.inkSoft },
  bannerName: { fontSize: 40, fontWeight: '900', color: C.ink },
  bannerRow: { flexDirection: 'row', gap: 10 },
  bigBtn: { backgroundColor: C.go, borderBottomWidth: 5, borderBottomColor: C.goEdge, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 20 },
  bigBtnText: { color: '#fff', fontSize: 19, fontWeight: '900' },
  softBtn: { backgroundColor: C.blueSoft, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16 },
  softBtnText: { color: C.blueInk, fontSize: 17, fontWeight: '800' },
  // level tabs
  levelTabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 16, padding: 4, gap: 4 },
  levelTab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12 },
  levelTabOn: { backgroundColor: C.card },
  levelTabText: { fontSize: 15, fontWeight: '800', color: C.inkSoft },
  levelTabTextOn: { color: C.ink },

  // dino dig
  stratum: { position: 'absolute', left: 0, right: 0, opacity: 0.6, borderRadius: 6 },
  pit: {
    position: 'absolute',
    backgroundColor: DIRT.floor,
    borderWidth: 4,
    borderColor: DIRT.floorEdge,
  },
  fossil: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fossilText: {
    fontWeight: '900',
    color: DIRT.bone,
    includeFontPadding: false,
    textShadowColor: DIRT.boneShadow,
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 1,
  },
  miniBone: { position: 'absolute', backgroundColor: DIRT.bone, borderRadius: 20, opacity: 0.55 },
  digHint: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    backgroundColor: DIRT.hint,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  digHintText: { fontSize: 18, fontWeight: '800', color: DIRT.boneShadow },
  // home
  homeTop: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 },
  gear: { borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.7)', paddingVertical: 8, paddingHorizontal: 14 },
  gearFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#CFE3DB' },
  gearText: { fontSize: 14, fontWeight: '700', color: C.inkSoft },
  homeCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 16, paddingBottom: 16 },
  homeWordmark: { fontSize: 22, fontWeight: '900', color: C.inkSoft, letterSpacing: 2, textTransform: 'uppercase' },
  homeTiles: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, alignItems: 'center' },
  homeTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 5,
    shadowColor: '#0B2A22',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  playBtn: {
    backgroundColor: C.go,
    borderBottomWidth: 8,
    borderBottomColor: C.goEdge,
    borderRadius: 32,
    paddingVertical: 20,
    paddingHorizontal: 56,
    shadowColor: '#0B2A22',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  playText: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: 0.5 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,45,38,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  askCard: { backgroundColor: C.card, borderRadius: 26, padding: 24, alignItems: 'center', maxWidth: 460, width: '100%', gap: 8 },
  askEmoji: { fontSize: 44 },
  askTitle: { fontSize: 28, fontWeight: '900', color: C.ink },
  askBody: { fontSize: 18, color: C.inkSoft, textAlign: 'center', lineHeight: 25, marginBottom: 6 },

  // sand trace
  sea: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: BEACH.sea },
  seaShallow: { position: 'absolute', left: 0, right: 0, backgroundColor: BEACH.seaLight },
  foamRow: { position: 'absolute', left: -20, flexDirection: 'row' },
  foamBubble: { width: 22, height: 18, borderRadius: 11, backgroundColor: BEACH.foam, marginRight: 0 },
  startDot: { position: 'absolute', backgroundColor: BEACH.start, borderWidth: 3, borderColor: '#FFFFFF' },
  popStar: { position: 'absolute', fontSize: 30 },
  beachThing: { position: 'absolute' },
  wave: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: BEACH.seaLight, zIndex: 150, elevation: 15 },
  waveFoam: { position: 'absolute', left: -10, bottom: -14, flexDirection: 'row' },
  waveBubble: { width: 26, height: 26, borderRadius: 13, backgroundColor: BEACH.foam },
});

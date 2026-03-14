"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FireType = "A" | "B" | "C" | "D" | "F";
type RoomKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";

type FireState = {
  roomKey: RoomKey;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  type: FireType;
  extinguished: boolean;
};

type LeaderboardEntry = {
  name: string;
  score: number;
  timeLeft: number;
  mistakes: number;
  createdAt: string;
};

type SavePayload = {
  player: {
    x: number;
    y: number;
    angle: number;
  };
  fires: FireState[];
  selectedExtinguisher: FireType;
  timeLeft: number;
  score: number;
  mistakes: number;
  finished: boolean;
  won: boolean;
  scoreSubmitted: boolean;
};

type HudState = {
  fps: number;
  x: number;
  y: number;
  angle: number;
  currentCell: string;
  timeLeft: number;
  score: number;
  mistakes: number;
  firesRemaining: number;
  selectedExtinguisher: FireType;
  targetRoom: RoomKey | null;
};

const SAVE_KEY = "pozar-world-fpp-save-v1";
const LEADERBOARD_KEY = "pozar-world-fpp-leaderboard-v1";
const ROOM_KEYS: RoomKey[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const EXTINGUISHER_ORDER: FireType[] = ["A", "B", "C", "D", "F"];
const FOV = Math.PI / 3;
const MOVE_SPEED = 2.85;
const STRAFE_SPEED = 2.45;
const ROT_SPEED = 2.25;
const COLLISION_RADIUS = 0.18;
const SPRAY_RANGE = 2.6;
const SPRAY_ANGLE = 0.16;

const MAP_LAYOUT = [
  "#################",
  "#.....#...#....X#",
  "#.###.#.#.#.###.#",
  "#.#A..#.#..B..#.#",
  "#.#...#.#.....#.#",
  "#.#.###.###.###.#",
  "#...#C....#...#.#",
  "###.#.....#.###.#",
  "#D..#..E..#..F..#",
  "#...###.###.....#",
  "#.###...#...###.#",
  "#.#G....#....H#.#",
  "#.#.....#.....#.#",
  "#.#.###.###.###.#",
  "#..I..#...#..J..#",
  "#.....#...#.....#",
  "#################",
] as const;

const ROOM_INFO: Record<RoomKey, { name: string; fireType: FireType; hint: string }> = {
  A: {
    name: "Archiwum dokumentów",
    fireType: "A",
    hint: "Płoną kartony, segregatory i drewniane regały.",
  },
  B: {
    name: "Magazyn rozpuszczalników",
    fireType: "B",
    hint: "Pali się rozlana ciecz palna i opary chemiczne.",
  },
  C: {
    name: "Stacja gazowa",
    fireType: "C",
    hint: "Ogień rozwija się przy instalacji i przewodach gazowych.",
  },
  D: {
    name: "Warsztat metali",
    fireType: "D",
    hint: "Żarzy się metaliczny pył i rozgrzane elementy metali.",
  },
  E: {
    name: "Kuchnia personelu",
    fireType: "F",
    hint: "Płoną tłuszcze i oleje spożywcze w strefie kuchennej.",
  },
  F: {
    name: "Magazyn drewna",
    fireType: "A",
    hint: "Pożar objął drewno, papier i materiały stałe.",
  },
  G: {
    name: "Laboratorium cieczy palnych",
    fireType: "B",
    hint: "Pali się rozlana substancja ciekła i jej opary.",
  },
  H: {
    name: "Rozdzielnia gazowa",
    fireType: "C",
    hint: "Źródło ognia jest związane z instalacją gazową.",
  },
  I: {
    name: "Szlifownia metali lekkich",
    fireType: "D",
    hint: "Zapaliły się opiłki i pył metali lekkich.",
  },
  J: {
    name: "Strefa frytownic",
    fireType: "F",
    hint: "Płoną oleje i tłuszcze gastronomiczne.",
  },
};

const EXTINGUISHER_HELP: Record<FireType, string> = {
  A: "Pożary ciał stałych, np. drewno, papier.",
  B: "Pożary cieczy palnych.",
  C: "Pożary gazów.",
  D: "Pożary metali.",
  F: "Pożary tłuszczów i olejów kuchennych.",
};

const ROOM_POSITIONS = (() => {
  const result = {} as Record<RoomKey, { x: number; y: number }>;
  for (let y = 0; y < MAP_LAYOUT.length; y += 1) {
    for (let x = 0; x < MAP_LAYOUT[y].length; x += 1) {
      const cell = MAP_LAYOUT[y][x];
      if (ROOM_KEYS.includes(cell as RoomKey)) {
        result[cell as RoomKey] = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return result;
})();

function readCell(x: number, y: number) {
  const row = MAP_LAYOUT[Math.floor(y)];
  if (!row) return "#";
  return row[Math.floor(x)] ?? "#";
}

function isWall(cell: string) {
  return cell === "#";
}

function isExit(cell: string) {
  return cell === "X";
}

function isRoom(cell: string): cell is RoomKey {
  return ROOM_KEYS.includes(cell as RoomKey);
}

function isWalkable(cell: string) {
  return cell !== "#";
}

function normalizeAngle(angle: number) {
  let next = angle;
  while (next < -Math.PI) next += Math.PI * 2;
  while (next > Math.PI) next -= Math.PI * 2;
  return next;
}

function createScenario(): FireState[] {
  return ROOM_KEYS.map((roomKey) => ({
    roomKey,
    x: ROOM_POSITIONS[roomKey].x,
    y: ROOM_POSITIONS[roomKey].y,
    hp: 100,
    maxHp: 100,
    type: ROOM_INFO[roomKey].fireType,
    extinguished: false,
  }));
}

function readLeaderboard(): LeaderboardEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLeaderboard(entries: LeaderboardEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
}

function castRay(originX: number, originY: number, angle: number) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  let mapX = Math.floor(originX);
  let mapY = Math.floor(originY);

  const deltaDistX = Math.abs(1 / (dirX || 0.00001));
  const deltaDistY = Math.abs(1 / (dirY || 0.00001));

  let stepX = 0;
  let stepY = 0;
  let sideDistX = 0;
  let sideDistY = 0;

  if (dirX < 0) {
    stepX = -1;
    sideDistX = (originX - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - originX) * deltaDistX;
  }

  if (dirY < 0) {
    stepY = -1;
    sideDistY = (originY - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - originY) * deltaDistY;
  }

  let side = 0;
  let hitCell = "#";

  for (let i = 0; i < 96; i += 1) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }

    hitCell = readCell(mapX, mapY);
    if (isWall(hitCell)) break;
  }

  const rawDistance =
    side === 0
      ? (mapX - originX + (1 - stepX) / 2) / (dirX || 0.00001)
      : (mapY - originY + (1 - stepY) / 2) / (dirY || 0.00001);

  return {
    distance: Math.max(0.0001, rawDistance),
    side,
    hitCell,
  };
}

function hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(6, Math.ceil(distance * 20));

  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const sampleX = fromX + dx * t;
    const sampleY = fromY + dy * t;
    if (isWall(readCell(sampleX, sampleY))) return false;
  }

  return true;
}

export default function PozarWorldFpp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const playerRef = useRef({ x: 1.6, y: 1.6, angle: 0, walkPhase: 0 });
  const animationRef = useRef<number | null>(null);
  const hudTickRef = useRef(0);
  const fpsFramesRef = useRef(0);
  const fpsTimeRef = useRef(0);
  const selectedExtinguisherRef = useRef<FireType>("A");
  const sprayPenaltyCooldownRef = useRef(0);
  const firesRef = useRef<FireState[]>(createScenario());
  const timeLeftRef = useRef(480);
  const scoreRef = useRef(0);
  const mistakesRef = useRef(0);
  const finishedRef = useRef(false);
  const wonRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [firesSnapshot, setFiresSnapshot] = useState<FireState[]>(firesRef.current);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [message, setMessage] = useState(
    "To jest właściwy kierunek: jeden świat FPP, pokoje narysowane w silniku, ogień widać na żywo, gaśnicę trzymasz w ręku."
  );
  const [nickname, setNickname] = useState("Gracz");
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [hud, setHud] = useState<HudState>({
    fps: 0,
    x: 1.6,
    y: 1.6,
    angle: 0,
    currentCell: ".",
    timeLeft: 480,
    score: 0,
    mistakes: 0,
    firesRemaining: 10,
    selectedExtinguisher: "A",
    targetRoom: null,
  });

  const targetFire = useMemo(() => {
    if (!hud.targetRoom) return null;
    return firesSnapshot.find((fire) => fire.roomKey === hud.targetRoom) ?? null;
  }, [hud.targetRoom, firesSnapshot]);

  const finished = hud.timeLeft <= 0 || (firesSnapshot.every((fire) => fire.extinguished) && wonRef.current);

  useEffect(() => {
    setMounted(true);
    setLeaderboard(readLeaderboard());

    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavePayload;
      playerRef.current = {
        x: parsed.player.x,
        y: parsed.player.y,
        angle: parsed.player.angle,
        walkPhase: 0,
      };
      firesRef.current = parsed.fires;
      selectedExtinguisherRef.current = parsed.selectedExtinguisher;
      timeLeftRef.current = parsed.timeLeft;
      scoreRef.current = parsed.score;
      mistakesRef.current = parsed.mistakes;
      finishedRef.current = parsed.finished;
      wonRef.current = parsed.won;
      setScoreSubmitted(parsed.scoreSubmitted);
      setFiresSnapshot(parsed.fires);
    } catch {
      // ignore broken save
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      keysRef.current[key] = true;

      if (key === "1") selectedExtinguisherRef.current = "A";
      if (key === "2") selectedExtinguisherRef.current = "B";
      if (key === "3") selectedExtinguisherRef.current = "C";
      if (key === "4") selectedExtinguisherRef.current = "D";
      if (key === "5") selectedExtinguisherRef.current = "F";

      if (event.code === "Space") event.preventDefault();
    }

    function onKeyUp(event: KeyboardEvent) {
      keysRef.current[event.key.toLowerCase()] = false;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let previous = performance.now();

    const render = (now: number) => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const dt = Math.min((now - previous) / 1000, 0.033);
      previous = now;

      if (!finishedRef.current) {
        const forward = (keysRef.current["w"] || keysRef.current["arrowup"] ? 1 : 0) -
          (keysRef.current["s"] || keysRef.current["arrowdown"] ? 1 : 0);
        const strafe = (keysRef.current["d"] ? 1 : 0) - (keysRef.current["a"] ? 1 : 0);
        const turn = (keysRef.current["arrowright"] ? 1 : 0) - (keysRef.current["arrowleft"] ? 1 : 0);

        playerRef.current.angle += turn * ROT_SPEED * dt;

        const moveX =
          Math.cos(playerRef.current.angle) * forward * MOVE_SPEED * dt +
          Math.cos(playerRef.current.angle + Math.PI / 2) * strafe * STRAFE_SPEED * dt;
        const moveY =
          Math.sin(playerRef.current.angle) * forward * MOVE_SPEED * dt +
          Math.sin(playerRef.current.angle + Math.PI / 2) * strafe * STRAFE_SPEED * dt;

        const nextX = playerRef.current.x + moveX;
        const nextY = playerRef.current.y + moveY;

        const canMoveX =
          isWalkable(readCell(nextX + Math.sign(moveX || 1) * COLLISION_RADIUS, playerRef.current.y)) &&
          isWalkable(readCell(nextX, playerRef.current.y + COLLISION_RADIUS)) &&
          isWalkable(readCell(nextX, playerRef.current.y - COLLISION_RADIUS));

        const canMoveY =
          isWalkable(readCell(playerRef.current.x, nextY + Math.sign(moveY || 1) * COLLISION_RADIUS)) &&
          isWalkable(readCell(playerRef.current.x + COLLISION_RADIUS, nextY)) &&
          isWalkable(readCell(playerRef.current.x - COLLISION_RADIUS, nextY));

        if (canMoveX) playerRef.current.x = nextX;
        if (canMoveY) playerRef.current.y = nextY;

        if (Math.abs(forward) + Math.abs(strafe) > 0) {
          playerRef.current.walkPhase += dt * 10;
        }

        timeLeftRef.current = Math.max(0, timeLeftRef.current - dt);
        sprayPenaltyCooldownRef.current = Math.max(0, sprayPenaltyCooldownRef.current - dt);

        if (timeLeftRef.current <= 0) {
          finishedRef.current = true;
          wonRef.current = false;
          setMessage("Koniec czasu. Gra żyje i renderuje się płynnie, ale misja została przegrana.");
        }
      }

      const bob = Math.sin(playerRef.current.walkPhase) * 5;

      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.58);
      sky.addColorStop(0, "#6b7280");
      sky.addColorStop(0.45, "#334155");
      sky.addColorStop(1, "#0f172a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height * 0.58);

      const floor = ctx.createLinearGradient(0, height * 0.46, 0, height);
      floor.addColorStop(0, "#1e293b");
      floor.addColorStop(0.3, "#111827");
      floor.addColorStop(1, "#020617");
      ctx.fillStyle = floor;
      ctx.fillRect(0, height * 0.46, width, height * 0.54);

      const rays = Math.min(520, Math.floor(width / 2));
      const columnWidth = width / rays;
      const depthBuffer = new Array<number>(rays).fill(9999);

      for (let i = 0; i < rays; i += 1) {
        const cameraX = i / (rays - 1) - 0.5;
        const rayAngle = playerRef.current.angle + cameraX * FOV;
        const hit = castRay(playerRef.current.x, playerRef.current.y, rayAngle);
        const correctedDistance = hit.distance * Math.cos(rayAngle - playerRef.current.angle);
        depthBuffer[i] = correctedDistance;

        const wallHeight = Math.min(height * 1.45, (height * 0.95) / Math.max(correctedDistance, 0.0001));
        const top = height / 2 - wallHeight / 2 + bob;

        let brightness = Math.max(0.18, 1 - correctedDistance / 12);
        if (hit.side === 1) brightness *= 0.78;
        const flicker = 0.985 + Math.sin(now * 0.002 + i * 0.031) * 0.015;
        brightness *= flicker;

        const r = Math.floor(55 + 125 * brightness);
        const g = Math.floor(70 + 105 * brightness);
        const b = Math.floor(85 + 90 * brightness);

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(i * columnWidth, top, columnWidth + 1, wallHeight);

        ctx.fillStyle = `rgba(255,255,255,${0.02 * brightness})`;
        ctx.fillRect(i * columnWidth, top, columnWidth + 1, wallHeight * 0.08);
      }

      const activeFires = firesRef.current
        .filter((fire) => !fire.extinguished)
        .map((fire) => {
          const dx = fire.x - playerRef.current.x;
          const dy = fire.y - playerRef.current.y;
          const distance = Math.hypot(dx, dy);
          const angleToFire = normalizeAngle(Math.atan2(dy, dx) - playerRef.current.angle);
          return { fire, distance, angleToFire };
        })
        .filter((entry) => Math.abs(entry.angleToFire) < FOV * 0.7 + 0.2)
        .sort((a, b) => b.distance - a.distance);

      let focusedTarget: RoomKey | null = null;
      let focusedDistance = 999;

      for (const entry of activeFires) {
        const { fire, distance, angleToFire } = entry;
        const projectedX = width / 2 + (Math.tan(angleToFire) / Math.tan(FOV / 2)) * (width / 2);
        const size = Math.min(height * 0.85, (height * 0.62) / Math.max(distance, 0.0001));
        const spriteWidth = size * 0.72;
        const spriteHeight = size;
        const top = height / 2 - spriteHeight / 2 + bob + 18;
        const left = projectedX - spriteWidth / 2;
        const right = projectedX + spriteWidth / 2;

        if (Math.abs(angleToFire) < SPRAY_ANGLE && distance < focusedDistance && hasLineOfSight(playerRef.current.x, playerRef.current.y, fire.x, fire.y)) {
          focusedTarget = fire.roomKey;
          focusedDistance = distance;
        }

        const startColumn = Math.max(0, Math.floor(left / columnWidth));
        const endColumn = Math.min(rays - 1, Math.ceil(right / columnWidth));
        let visible = false;
        for (let c = startColumn; c <= endColumn; c += 1) {
          if (distance < depthBuffer[c]) {
            visible = true;
            break;
          }
        }
        if (!visible) continue;

        ctx.save();
        ctx.translate(projectedX, top + spriteHeight * 0.58);

        const flicker = 1 + Math.sin(now * 0.02 + fire.x * 1.7) * 0.06;
        ctx.scale(flicker, flicker);

        const outer = ctx.createRadialGradient(0, 0, spriteWidth * 0.05, 0, 0, spriteWidth * 0.62);
        outer.addColorStop(0, "rgba(255,250,180,0.95)");
        outer.addColorStop(0.35, "rgba(255,180,40,0.88)");
        outer.addColorStop(0.7, "rgba(255,80,20,0.62)");
        outer.addColorStop(1, "rgba(255,50,0,0)");
        ctx.fillStyle = outer;
        ctx.beginPath();
        ctx.ellipse(0, 0, spriteWidth * 0.48, spriteHeight * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255,110,20,0.85)";
        ctx.beginPath();
        ctx.moveTo(-spriteWidth * 0.18, spriteHeight * 0.15);
        ctx.quadraticCurveTo(-spriteWidth * 0.22, -spriteHeight * 0.3, 0, -spriteHeight * 0.52);
        ctx.quadraticCurveTo(spriteWidth * 0.22, -spriteHeight * 0.28, spriteWidth * 0.18, spriteHeight * 0.16);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "rgba(255,215,120,0.95)";
        ctx.beginPath();
        ctx.moveTo(-spriteWidth * 0.08, spriteHeight * 0.06);
        ctx.quadraticCurveTo(-spriteWidth * 0.09, -spriteHeight * 0.15, 0, -spriteHeight * 0.32);
        ctx.quadraticCurveTo(spriteWidth * 0.09, -spriteHeight * 0.15, spriteWidth * 0.08, spriteHeight * 0.06);
        ctx.closePath();
        ctx.fill();

        for (let s = 0; s < 6; s += 1) {
          const px = (Math.sin(now * 0.01 + s + fire.x) * 0.5) * spriteWidth * 0.3;
          const py = -spriteHeight * 0.18 - ((now * 0.04 + s * 13) % (spriteHeight * 0.35));
          ctx.fillStyle = "rgba(255,180,90,0.6)";
          ctx.fillRect(px, py, 3, 3);
        }

        ctx.restore();
      }

      if (!finishedRef.current && keysRef.current[" "] && focusedTarget && focusedDistance <= SPRAY_RANGE) {
        const selectedType = selectedExtinguisherRef.current;
        const fire = firesRef.current.find((item) => item.roomKey === focusedTarget);
        if (fire && !fire.extinguished) {
          if (fire.type === selectedType) {
            fire.hp = Math.max(0, fire.hp - dt * 70);
            if (fire.hp === 0 && !fire.extinguished) {
              fire.extinguished = true;
              scoreRef.current += 200;
              setMessage(`Pożar w pomieszczeniu ${ROOM_INFO[focusedTarget].name} został ugaszony.`);
              setFiresSnapshot([...firesRef.current]);
            }
          } else if (sprayPenaltyCooldownRef.current <= 0) {
            sprayPenaltyCooldownRef.current = 0.65;
            mistakesRef.current += 1;
            timeLeftRef.current = Math.max(0, timeLeftRef.current - 8);
            setMessage(`Zła gaśnica. ${EXTINGUISHER_HELP[selectedType]}`);
          }
        }
      }

      const selectedType = selectedExtinguisherRef.current;
      const sprayActive = !finishedRef.current && !!keysRef.current[" "];

      if (allFiresOut(firesRef.current) && isExit(readCell(playerRef.current.x, playerRef.current.y)) && !wonRef.current) {
        finishedRef.current = true;
        wonRef.current = true;
        scoreRef.current += Math.floor(timeLeftRef.current) * 5;
        setMessage("Wszystkie pożary ugaszone. Dotarłeś do wyjścia ewakuacyjnego.");
      }

      drawWeapon(ctx, width, height, selectedType, sprayActive, now, focusedTarget !== null && focusedDistance <= SPRAY_RANGE, bob);
      drawCrosshair(ctx, width, height, focusedTarget !== null && focusedDistance <= SPRAY_RANGE, sprayActive, bob);
      drawMinimap(ctx, width, height, playerRef.current.x, playerRef.current.y, playerRef.current.angle, firesRef.current);

      fpsFramesRef.current += 1;
      if (now - fpsTimeRef.current >= 500) {
        const fps = (fpsFramesRef.current * 1000) / Math.max(1, now - fpsTimeRef.current);
        fpsFramesRef.current = 0;
        fpsTimeRef.current = now;

        setHud({
          fps: Math.round(fps),
          x: playerRef.current.x,
          y: playerRef.current.y,
          angle: ((playerRef.current.angle * 180) / Math.PI + 360) % 360,
          currentCell: readCell(playerRef.current.x, playerRef.current.y),
          timeLeft: Math.ceil(timeLeftRef.current),
          score: scoreRef.current,
          mistakes: mistakesRef.current,
          firesRemaining: firesRef.current.filter((fire) => !fire.extinguished).length,
          selectedExtinguisher: selectedType,
          targetRoom: focusedTarget,
        });
      }

      if (now - hudTickRef.current > 180) {
        setFiresSnapshot([...firesRef.current]);
        hudTickRef.current = now;
      }

      animationRef.current = window.requestAnimationFrame(render);
    };

    animationRef.current = window.requestAnimationFrame(render);

    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [mounted]);

  function allFiresOut(fires: FireState[]) {
    return fires.every((fire) => fire.extinguished);
  }

  function resetMission() {
    firesRef.current = createScenario();
    playerRef.current = { x: 1.6, y: 1.6, angle: 0, walkPhase: 0 };
    selectedExtinguisherRef.current = "A";
    timeLeftRef.current = 480;
    scoreRef.current = 0;
    mistakesRef.current = 0;
    finishedRef.current = false;
    wonRef.current = false;
    setScoreSubmitted(false);
    setFiresSnapshot([...firesRef.current]);
    setMessage("Nowa misja. Pokoje są częścią świata, a ogień żyje bez osobnych instancji.");
  }

  function saveGame() {
    const payload: SavePayload = {
      player: {
        x: playerRef.current.x,
        y: playerRef.current.y,
        angle: playerRef.current.angle,
      },
      fires: firesRef.current,
      selectedExtinguisher: selectedExtinguisherRef.current,
      timeLeft: timeLeftRef.current,
      score: scoreRef.current,
      mistakes: mistakesRef.current,
      finished: finishedRef.current,
      won: wonRef.current,
      scoreSubmitted,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    setMessage("Zapisano stan gry lokalnie w przeglądarce.");
  }

  function loadGame() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) {
        setMessage("Brak zapisanego stanu gry.");
        return;
      }
      const parsed = JSON.parse(raw) as SavePayload;
      playerRef.current = {
        x: parsed.player.x,
        y: parsed.player.y,
        angle: parsed.player.angle,
        walkPhase: 0,
      };
      firesRef.current = parsed.fires;
      selectedExtinguisherRef.current = parsed.selectedExtinguisher;
      timeLeftRef.current = parsed.timeLeft;
      scoreRef.current = parsed.score;
      mistakesRef.current = parsed.mistakes;
      finishedRef.current = parsed.finished;
      wonRef.current = parsed.won;
      setScoreSubmitted(parsed.scoreSubmitted);
      setFiresSnapshot([...parsed.fires]);
      setMessage("Wczytano zapis gry.");
    } catch {
      setMessage("Nie udało się wczytać zapisu gry.");
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  function submitScore() {
    if (!wonRef.current || scoreSubmitted) return;
    const entry: LeaderboardEntry = {
      name: nickname.trim() || "Gracz",
      score: scoreRef.current,
      timeLeft: Math.ceil(timeLeftRef.current),
      mistakes: mistakesRef.current,
      createdAt: new Date().toISOString(),
    };

    const nextEntries = [...leaderboard, entry]
      .sort((a, b) => b.score - a.score || b.timeLeft - a.timeLeft || a.mistakes - b.mistakes)
      .slice(0, 10);

    setLeaderboard(nextEntries);
    writeLeaderboard(nextEntries);
    setScoreSubmitted(true);
    setMessage("Wynik zapisany w tabeli TOP 10.");
  }

  return (
    <div ref={wrapperRef} className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute left-4 top-4 max-w-[460px] rounded-2xl border border-slate-700 bg-black/45 px-4 py-3 backdrop-blur-md">
        <div className="text-xs uppercase tracking-[0.28em] text-slate-300">Pożar — świat FPP</div>
        <div className="mt-2 text-2xl font-semibold leading-tight">
          Pokoje są narysowane w silniku, a ogień żyje w świecie gry
        </div>
        <div className="mt-2 text-sm leading-relaxed text-slate-300">{message}</div>
      </div>

      <div className="absolute right-4 top-4 rounded-2xl border border-slate-700 bg-black/45 px-4 py-3 backdrop-blur-md text-sm">
        <div>FPS: <span className="font-semibold text-cyan-300">{hud.fps}</span></div>
        <div>Pozycja: <span className="font-semibold">{hud.x.toFixed(2)}, {hud.y.toFixed(2)}</span></div>
        <div>Kąt: <span className="font-semibold">{hud.angle.toFixed(0)}°</span></div>
        <div>Wyposażenie: <span className="font-semibold">Gaśnica {hud.selectedExtinguisher}</span></div>
        <button
          className="mt-3 w-full rounded-xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-white"
          onClick={toggleFullscreen}
        >
          Fullscreen
        </button>
      </div>

      <div className="absolute left-4 bottom-4 max-w-[640px] rounded-2xl border border-slate-700 bg-black/45 px-4 py-4 backdrop-blur-md">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <HudTile label="Pożary" value={String(hud.firesRemaining)} />
          <HudTile label="Czas" value={`${hud.timeLeft}s`} />
          <HudTile label="Wynik" value={String(hud.score)} />
          <HudTile label="Błędy" value={String(hud.mistakes)} />
          <HudTile label="Komórka" value={hud.currentCell} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton label="Zapisz" onClick={saveGame} />
          <ActionButton label="Wczytaj" onClick={loadGame} />
          <ActionButton label="Nowa misja" onClick={resetMission} />
        </div>

        <div className="mt-4 text-xs leading-relaxed text-slate-400">
          Sterowanie: <span className="text-slate-200">W/S</span> przód/tył, <span className="text-slate-200">A/D</span> ruch boczny, <span className="text-slate-200">←/→</span> obrót, <span className="text-slate-200">1–5</span> wybór gaśnicy, <span className="text-slate-200">spacja</span> gaszenie.
        </div>
      </div>

      {hud.targetRoom && targetFire && !targetFire.extinguished && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-2xl border border-orange-500/30 bg-orange-950/40 px-4 py-3 text-sm backdrop-blur-md">
          <div className="font-semibold">Celownik na: {ROOM_INFO[hud.targetRoom].name}</div>
          <div className="text-slate-300">Wymagana gaśnica: {targetFire.type} · HP ognia: {Math.ceil(targetFire.hp)}%</div>
        </div>
      )}

      {finishedRef.current && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/78 p-6 backdrop-blur-sm">
          <div className={`w-full max-w-2xl rounded-[28px] border p-6 ${wonRef.current ? "border-emerald-600 bg-emerald-950/30" : "border-red-600 bg-red-950/30"}`}>
            <div className="text-xs uppercase tracking-[0.28em] text-slate-300">Koniec misji</div>
            <div className="mt-2 text-3xl font-semibold">
              {wonRef.current ? "Misja zakończona sukcesem" : "Misja nieudana"}
            </div>
            <div className="mt-3 text-slate-200">
              Wynik: <span className="font-semibold">{hud.score}</span> · Czas: <span className="font-semibold">{hud.timeLeft}s</span> · Błędy: <span className="font-semibold">{hud.mistakes}</span>
            </div>

            {wonRef.current && !scoreSubmitted && (
              <div className="mt-6 space-y-3">
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full rounded-2xl border border-slate-600 bg-black/40 px-4 py-3 outline-none"
                  placeholder="Twój nick"
                />
                <button
                  className="w-full rounded-xl bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-white"
                  onClick={submitScore}
                >
                  Zapisz do TOP 10
                </button>
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ActionButton label="Nowa misja" onClick={resetMission} />
              <ActionButton label="Wczytaj zapis" onClick={loadGame} />
            </div>

            <div className="mt-6 max-h-60 space-y-2 overflow-auto">
              <div className="text-sm font-medium">TOP 10</div>
              {leaderboard.length === 0 ? (
                <div className="text-sm text-slate-300">Brak zapisanych wyników.</div>
              ) : (
                leaderboard.map((entry, index) => (
                  <div key={`${entry.createdAt}-${index}`} className="flex items-center justify-between rounded-2xl border border-slate-700 bg-black/30 p-3">
                    <div>
                      <div className="font-semibold">#{index + 1} {entry.name}</div>
                      <div className="text-xs text-slate-400">czas: {entry.timeLeft}s · błędy: {entry.mistakes}</div>
                    </div>
                    <div className="rounded-lg bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-900">{entry.score} pkt</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HudTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-white"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  targetLocked: boolean,
  sprayActive: boolean,
  bob: number
) {
  const cx = width / 2;
  const cy = height / 2 + bob;
  ctx.save();
  ctx.strokeStyle = targetLocked ? "rgba(255,180,80,0.95)" : "rgba(255,255,255,0.7)";
  ctx.lineWidth = sprayActive ? 2.4 : 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();
  ctx.restore();
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  extinguisher: FireType,
  sprayActive: boolean,
  now: number,
  targetLocked: boolean,
  bob: number
) {
  const baseX = width * 0.78;
  const baseY = height * 0.78 + bob * 0.4;

  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.rotate(-0.18 + Math.sin(now * 0.003) * 0.01);

  ctx.fillStyle = "rgba(15,23,42,0.8)";
  ctx.beginPath();
  ctx.roundRect(-70, -20, 180, 180, 26);
  ctx.fill();

  ctx.fillStyle = targetLocked ? "#ef4444" : "#dc2626";
  ctx.beginPath();
  ctx.roundRect(5, -5, 68, 122, 18);
  ctx.fill();

  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(22, -22, 10, 20);
  ctx.fillRect(54, -22, 10, 20);
  ctx.fillRect(58, -36, 34, 10);
  ctx.fillRect(89, -28, 28, 8);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(extinguisher, 28, 58);

  ctx.fillStyle = "#0f172a";
  ctx.font = "12px sans-serif";
  ctx.fillText("GAŚNICA", 20, 82);

  if (sprayActive) {
    const spray = ctx.createLinearGradient(112, -24, 245, -60);
    spray.addColorStop(0, "rgba(255,255,255,0.75)");
    spray.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spray;
    ctx.beginPath();
    ctx.moveTo(112, -24);
    ctx.lineTo(245, -60 + Math.sin(now * 0.02) * 6);
    ctx.lineTo(250, -15 + Math.cos(now * 0.017) * 6);
    ctx.lineTo(112, -10);
    ctx.closePath();
    ctx.fill();

    for (let i = 0; i < 14; i += 1) {
      const px = 120 + i * 10 + ((now * 0.07 + i * 13) % 18);
      const py = -22 - i * 1.8 + Math.sin(now * 0.015 + i) * 4;
      ctx.fillStyle = `rgba(255,255,255,${0.28 + (i % 3) * 0.1})`;
      ctx.beginPath();
      ctx.arc(px, py, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  playerX: number,
  playerY: number,
  playerAngle: number,
  fires: FireState[]
) {
  const cellSize = 12;
  const pad = 18;
  const mapW = MAP_LAYOUT[0].length * cellSize;
  const mapH = MAP_LAYOUT.length * cellSize;
  const originX = width - mapW - pad;
  const originY = 96;

  ctx.save();
  ctx.fillStyle = "rgba(2,6,23,0.72)";
  ctx.fillRect(originX - 10, originY - 10, mapW + 20, mapH + 20);

  for (let y = 0; y < MAP_LAYOUT.length; y += 1) {
    for (let x = 0; x < MAP_LAYOUT[y].length; x += 1) {
      const cell = MAP_LAYOUT[y][x];
      if (cell === "#") ctx.fillStyle = "#111827";
      else if (cell === "X") ctx.fillStyle = "#166534";
      else if (isRoom(cell)) {
        const fire = fires.find((item) => item.roomKey === cell);
        ctx.fillStyle = fire && !fire.extinguished ? "#7f1d1d" : "#14532d";
      } else ctx.fillStyle = "#334155";

      ctx.fillRect(originX + x * cellSize, originY + y * cellSize, cellSize - 1, cellSize - 1);
    }
  }

  ctx.fillStyle = "#22d3ee";
  ctx.save();
  ctx.translate(originX + playerX * cellSize, originY + playerY * cellSize);
  ctx.rotate(playerAngle);
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -4);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

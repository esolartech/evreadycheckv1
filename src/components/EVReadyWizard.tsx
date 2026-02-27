"use client";

import React, { useMemo, useState } from "react";

type Step = "Q1" | "Q2" | "INPUTS" | "RESULT";
type PlugAnswer = "yes" | "no" | null;
type ChargeLevel = "L1" | "L2" | null;

type DayRow = {
  dayIndex: number;
  label: string;
  startingMiles: number;
  oneWayMiles: number;
  returnMiles: number;
  didFastCharge: boolean;
  fastChargeMiles: number; // fullRange when didFastCharge
  remainingMiles: number; // after reserve
  overnightChargeMiles: number; // added that night
  nextStartingMiles: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function clampNonNeg(n: number) {
  return Math.max(0, Math.round(n));
}

function calcOvernightMiles(opts: {
  homeLevel: "L1" | "L2";
  overnightHours: number;
  l1MilesPerHour?: number; // default 4
  l2MilesPerHour?: number; // default 25
}) {
  const { homeLevel, overnightHours, l1MilesPerHour = 4, l2MilesPerHour = 25 } = opts;
  const mph = homeLevel === "L1" ? l1MilesPerHour : l2MilesPerHour;
  return mph * overnightHours;
}

function parseDayList(input: string, maxDays: number) {
  const nums = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n))
    .filter((n) => n >= 0 && n < maxDays);

  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/**
 * Spreadsheet-matching logic per day:
 * - Start day with startingMiles
 * - Drive outbound (oneWayMiles)
 * - If fast charge occurs, it happens AFTER outbound and resets to fullRangeMiles
 * - Then drive return (returnMiles)
 * - RemainingRaw:
 *    if fastCharge: fullRangeMiles - returnMiles
 *    else: startingMiles - (oneWayMiles + returnMiles)
 * - Apply reserve buffer (subtract reserve, floor at 0)
 * - Overnight add overnightChargeMiles -> next day starting
 */
function simulateWeek(opts: {
  fullRangeMiles: number;
  reserveMiles: number;
  weekdayMilesPerDay: number; // Mon–Fri per-day roundtrip miles
  weekdayDriveDays: number; // 0..5
  weekendMilesPerDay: number; // Sat/Sun per-day roundtrip miles
  weekendDriveDays: number; // 0..2
  overnightWeekdayMiles: number;
  overnightWeekendMiles: number;
  fastChargeDays: number[]; // 0..6
}) {
  const {
    fullRangeMiles,
    reserveMiles,
    weekdayMilesPerDay,
    weekdayDriveDays,
    weekendMilesPerDay,
    weekendDriveDays,
    overnightWeekdayMiles,
    overnightWeekendMiles,
    fastChargeDays,
  } = opts;

  const fastSet = new Set(fastChargeDays);
  const rows: DayRow[] = [];

  let startingMiles = fullRangeMiles;

  // Build a per-day driving plan (Mon..Sun)
  // - First `weekdayDriveDays` weekdays have driving, rest are 0
  // - First `weekendDriveDays` weekend days have driving, rest are 0
  const weekdayPattern = Array(5)
    .fill(0)
    .map((_, i) => (i < weekdayDriveDays ? weekdayMilesPerDay : 0));
  const weekendPattern = Array(2)
    .fill(0)
    .map((_, i) => (i < weekendDriveDays ? weekendMilesPerDay : 0));
  const perDayMiles = [...weekdayPattern, ...weekendPattern]; // length 7

  for (let i = 0; i < 7; i++) {
    const label = DAY_LABELS[i];
    const dayMiles = perDayMiles[i] ?? 0;

    // Split into outbound + return (roundtrip)
    const oneWayMiles = Math.round(dayMiles / 2);
    const returnMiles = dayMiles - oneWayMiles;

    const isDrivingDay = dayMiles > 0;
    const wantsFastCharge = fastSet.has(i);
    const didFastCharge = Boolean(isDrivingDay && wantsFastCharge);

    let remainingRaw: number;
    let fastChargeMiles = 0;

    if (didFastCharge) {
      // Fast charge after outbound -> reset to full -> only subtract return
      fastChargeMiles = fullRangeMiles;
      remainingRaw = fullRangeMiles - returnMiles;
    } else {
      remainingRaw = startingMiles - (oneWayMiles + returnMiles);
    }

    // Apply reserve buffer
    const remainingMiles = clampNonNeg(remainingRaw - reserveMiles);

    // Overnight charge differs for weekday vs weekend
    const overnightChargeMiles = clampNonNeg(i < 5 ? overnightWeekdayMiles : overnightWeekendMiles);
    const nextStartingMiles = clampNonNeg(remainingMiles + overnightChargeMiles);

    rows.push({
      dayIndex: i,
      label,
      startingMiles: clampNonNeg(startingMiles),
      oneWayMiles,
      returnMiles,
      didFastCharge,
      fastChargeMiles,
      remainingMiles,
      overnightChargeMiles,
      nextStartingMiles,
    });

    startingMiles = nextStartingMiles;
  }

  // “Full resets needed” = count of days where fast charge happened
  const fullResetsPerWeek = rows.filter((r) => r.didFastCharge).length;

  const weeklyMilesDriven =
    weekdayMilesPerDay * weekdayDriveDays + weekendMilesPerDay * weekendDriveDays;

  // How many driving days hit 0 after reserve (signal of pain)
  const reserveFloorHits = rows.filter(
    (r) => r.remainingMiles === 0 && (r.oneWayMiles + r.returnMiles) > 0
  ).length;

  return { rows, fullResetsPerWeek, weeklyMilesDriven, reserveFloorHits, endingMiles: rows[6]?.nextStartingMiles ?? 0 };
}

export default function EVReadyWizard() {
  const [step, setStep] = useState<Step>("Q1");
  const [canPlug, setCanPlug] = useState<PlugAnswer>(null);
  const [level, setLevel] = useState<ChargeLevel>(null);

  // Driving inputs
  const [weekdayMilesPerDay, setWeekdayMilesPerDay] = useState<number>(140); // per weekday you drive
  const [weekdayDriveDays, setWeekdayDriveDays] = useState<number>(5); // 0..5

  const [weekendMilesPerDay, setWeekendMilesPerDay] = useState<number>(30); // 10–50 typical
  const [weekendDriveDays, setWeekendDriveDays] = useState<number>(0); // 0..2

  // Charging inputs
  const [weekdayChargeHours, setWeekdayChargeHours] = useState<number>(9); // 8–10 typical
  const [weekendChargeHours, setWeekendChargeHours] = useState<number>(16); // 15–18 typical

  // Range inputs
  const [fullRange, setFullRange] = useState<number>(260);
  const [reserveMiles, setReserveMiles] = useState<number>(10);

  // Fast charge plan (optional). 0-based day indices for Mon..Sun
  const [fastChargeDaysInput, setFastChargeDaysInput] = useState<string>("");

  const reset = () => {
    setStep("Q1");
    setCanPlug(null);
    setLevel(null);

    setWeekdayMilesPerDay(140);
    setWeekdayDriveDays(5);
    setWeekendMilesPerDay(30);
    setWeekendDriveDays(0);

    setWeekdayChargeHours(9);
    setWeekendChargeHours(16);

    setFullRange(260);
    setReserveMiles(10);
    setFastChargeDaysInput("");
  };

  const onQ1 = (ans: "yes" | "no") => {
    setCanPlug(ans);
    if (ans === "no") setStep("RESULT");
    else setStep("Q2");
  };

  const onQ2 = (ans: "L1" | "L2") => {
    setLevel(ans);
    // Good defaults per level
    if (ans === "L1") {
      setWeekdayChargeHours(9);
      setWeekendChargeHours(16);
    } else {
      setWeekdayChargeHours(6);
      setWeekendChargeHours(10);
    }
    setStep("INPUTS");
  };

  const fastChargeDays = useMemo(() => parseDayList(fastChargeDaysInput, 7), [fastChargeDaysInput]);

  const overnightWeekdayMiles = useMemo(() => {
    if (!level) return 0;
    return calcOvernightMiles({ homeLevel: level, overnightHours: weekdayChargeHours });
  }, [level, weekdayChargeHours]);

  const overnightWeekendMiles = useMemo(() => {
    if (!level) return 0;
    return calcOvernightMiles({ homeLevel: level, overnightHours: weekendChargeHours });
  }, [level, weekendChargeHours]);

  const sim = useMemo(() => {
    if (canPlug !== "yes" || !level) return null;
    return simulateWeek({
      fullRangeMiles: fullRange,
      reserveMiles,
      weekdayMilesPerDay,
      weekdayDriveDays,
      weekendMilesPerDay,
      weekendDriveDays,
      overnightWeekdayMiles,
      overnightWeekendMiles,
      fastChargeDays,
    });
  }, [
    canPlug,
    level,
    fullRange,
    reserveMiles,
    weekdayMilesPerDay,
    weekdayDriveDays,
    weekendMilesPerDay,
    weekendDriveDays,
    overnightWeekdayMiles,
    overnightWeekendMiles,
    fastChargeDays,
  ]);

  const result = useMemo(() => {
    if (canPlug === "no") {
      return {
        badge: "LEVEL 0",
        title: "⚠️ Not Ready Yet",
        color: "text-red-400",
        subtitle: "No overnight plug = high friction risk.",
        body:
          "Before buying, secure a consistent charging anchor: home parking access, workplace charging, or a reliable Level 2 near your routine.",
      };
    }

    if (canPlug !== "yes" || !level) return null;

    // Keep your heuristic using weekday miles per driving day (main pattern)
    const m = weekdayMilesPerDay;

    if (level === "L1") {
      if (m <= 50) {
        return {
          badge: "READY (L1)",
          title: "✅ EV Ready (Level 1 works)",
          color: "text-green-300",
          subtitle: "Your weekday driving fits Level 1 with long plug time.",
          body:
            "If you plug in consistently overnight (and especially on weekends), Level 1 can cover a surprising amount.",
        };
      }
      if (m <= 120) {
        return {
          badge: "READY + PLAN",
          title: "🟠 EV Ready (with a plan)",
          color: "text-orange-300",
          subtitle: "Level 1 can work, but you’ll want an occasional reset.",
          body:
            "Expect some weeks where you need a fast-charge reset depending on weekend driving and plug hours.",
        };
      }
      return {
        badge: "FAST-CHARGE DEPENDENT",
        title: "🚨 High Friction Risk (Level 1)",
        color: "text-red-400",
        subtitle: "Level 1 likely won’t keep up without frequent resets.",
        body:
          "With high weekday mileage, you’ll depend on fast charging unless you get Level 2 access.",
      };
    }

    // L2
    if (m <= 200) {
      return {
        badge: "LEVEL 3",
        title: "✅ EV Ready",
        color: "text-green-300",
        subtitle: "Level 2 makes your weekly rhythm easy.",
        body: "Charging becomes a routine: drive → park → plug → repeat.",
      };
    }
    return {
      badge: "LEVEL 2+",
      title: "✅ Likely Ready (with planning)",
      color: "text-yellow-300",
      subtitle: "You’re driving a lot—keep a reset option handy.",
      body:
        "Even with Level 2, heavy weeks may require a fast-charge reset depending on your route and buffer.",
    };
  }, [canPlug, level, weekdayMilesPerDay]);

  const showInputs = step === "INPUTS";
  const showResult = step === "RESULT";

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(34,197,94,0.10),transparent_45%)]" />

      <div className="max-w-2xl mx-auto px-5 py-10">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">areyouready4anEV</h1>
            <p className="text-gray-400 mt-2">
              Range isn’t the hard part. <span className="text-gray-200">Charging fit</span> is.
            </p>
          </div>

          <button
            onClick={reset}
            className="text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 px-3 py-2 rounded-lg"
          >
            Reset
          </button>
        </div>

        <div className="bg-gray-900/70 backdrop-blur border border-white/10 rounded-2xl p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          {/*

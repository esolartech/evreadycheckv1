"use client";

import React, { useMemo, useState } from "react";

type Step = "Q1" | "Q2" | "MILES" | "RESULT";
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
  overnightChargeMiles: number; // L1/L2 overnight miles added
  nextStartingMiles: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function clampNonNeg(n: number) {
  return Math.max(0, Math.round(n));
}

/**
 * Spreadsheet-matching daily schedule logic:
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
function calcEvSchedule(opts: {
  days: number; // rows to generate
  initialStartingMiles: number; // e.g. fullRangeMiles
  oneWayMiles: number; // outbound
  returnMiles: number; // return
  fullRangeMiles: number; // "full tank"
  overnightChargeMiles: number; // e.g. L1 overnight miles (36) OR L2 overnight miles
  reserveMiles: number; // e.g. 10
  fastChargeDays: number[]; // day indices (0-based)
}): DayRow[] {
  const {
    days,
    initialStartingMiles,
    oneWayMiles,
    returnMiles,
    fullRangeMiles,
    overnightChargeMiles,
    reserveMiles,
    fastChargeDays,
  } = opts;

  const fastSet = new Set(fastChargeDays);
  const rows: DayRow[] = [];

  let startingMiles = initialStartingMiles;

  for (let i = 0; i < days; i++) {
    const label = DAY_LABELS[i % 7];
    const didFastCharge = fastSet.has(i);

    let remainingRaw: number;
    let fastChargeMiles = 0;

    if (didFastCharge) {
      fastChargeMiles = fullRangeMiles;
      remainingRaw = fullRangeMiles - returnMiles;
    } else {
      remainingRaw = startingMiles - (oneWayMiles + returnMiles);
    }

    const remainingMiles = clampNonNeg(remainingRaw - reserveMiles);
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
      overnightChargeMiles: clampNonNeg(overnightChargeMiles),
      nextStartingMiles,
    });

    startingMiles = nextStartingMiles;
  }

  return rows;
}

function parseDayList(input: string, maxDays: number) {
  // "0,2,4" -> [0,2,4], de-duped, valid range
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

function calcOvernightMiles(opts: {
  homeLevel: "L1" | "L2";
  overnightHours?: number; // default 9
  l1MilesPerHour?: number; // default 4
  l2MilesPerHour?: number; // default 25
}) {
  const { homeLevel, overnightHours = 9, l1MilesPerHour = 4, l2MilesPerHour = 25 } = opts;
  const mph = homeLevel === "L1" ? l1MilesPerHour : l2MilesPerHour;
  return mph * overnightHours;
}

export default function EVReadyWizard() {
  const [step, setStep] = useState<Step>("Q1");
  const [canPlug, setCanPlug] = useState<PlugAnswer>(null);
  const [level, setLevel] = useState<ChargeLevel>(null);

  // Existing "pattern" inputs
  const [milesPerDay, setMilesPerDay] = useState<number>(140);
  const [drivingDays, setDrivingDays] = useState<number>(5);

  // Range / charging assumptions
  const [fullRange, setFullRange] = useState<number>(270);
  const [reserveMiles, setReserveMiles] = useState<number>(10);

  // “Spreadsheet schedule” inputs derived from your pattern:
  // Treat "miles per driving day" as a round trip; split into oneWay + return.
  // You can later expose oneWay/return as advanced settings.
  const oneWayMiles = useMemo(() => Math.round(milesPerDay / 2), [milesPerDay]);
  const returnMiles = useMemo(() => milesPerDay - oneWayMiles, [milesPerDay, oneWayMiles]);

  // Fast charge plan (day indices)
  const [fastChargeDaysInput, setFastChargeDaysInput] = useState<string>("");

  const reset = () => {
    setStep("Q1");
    setCanPlug(null);
    setLevel(null);

    setMilesPerDay(140);
    setDrivingDays(5);

    setFullRange(270);
    setReserveMiles(10);

    setFastChargeDaysInput("");
  };

  const onQ1 = (ans: "yes" | "no") => {
    setCanPlug(ans);
    if (ans === "no") {
      setStep("RESULT");
      return;
    }
    setStep("Q2");
  };

  const onQ2 = (ans: "L1" | "L2") => {
    setLevel(ans);
    setStep("MILES");
  };

  const showResult = step === "RESULT";
  const showMiles = step === "MILES";

  const overnightMiles = useMemo(() => {
    if (!level) return 0;
    return calcOvernightMiles({ homeLevel: level, overnightHours: 9 });
  }, [level]);

  // Build a 7-day schedule where “drivingDays” days have driving, and the rest are 0 miles.
  // To keep it premium + simple:
  // - We simulate as "drive days first" then "non-drive days" (still charging overnight).
  // - Users can optionally specify fast-charge day indices relative to this 0..6 sequence.
  const scheduleDays = 7;

  const fastChargeDays = useMemo(
    () => parseDayList(fastChargeDaysInput, scheduleDays),
    [fastChargeDaysInput]
  );

  // Create a per-day driving plan for the week:
  // First `drivingDays` days: drive (oneWayMiles + returnMiles); remaining days: 0.
  // We pass the per-day oneWay/return to the schedule calculator by zeroing them on non-driving days.
  const rows = useMemo(() => {
    if (canPlug !== "yes" || !level) return [];

    // We'll simulate day-by-day with variable driving.
    // We do that by calling calcEvSchedule on each day (since it expects constant oneWay/return),
    // so here is a simple manual loop to preserve the sheet rules while allowing 0-mile days.
    const rowsOut: DayRow[] = [];
    let startingMiles = fullRange;

    for (let i = 0; i < scheduleDays; i++) {
      const label = DAY_LABELS[i % 7];
      const isDriveDay = i < Math.min(7, Math.max(0, drivingDays));

      const owm = isDriveDay ? oneWayMiles : 0;
      const rtm = isDriveDay ? returnMiles : 0;

      const didFastCharge = fastChargeDays.includes(i);

      let remainingRaw: number;
      let fastChargeMiles = 0;

      if (didFastCharge && isDriveDay) {
        // Fast charge after outbound; if there is no driving that day, fast charge doesn't matter.
        fastChargeMiles = fullRange;
        remainingRaw = fullRange - rtm;
      } else {
        remainingRaw = startingMiles - (owm + rtm);
      }

      const remainingMiles = clampNonNeg(remainingRaw - reserveMiles);
      const nextStartingMiles = clampNonNeg(remainingMiles + overnightMiles);

      rowsOut.push({
        dayIndex: i,
        label,
        startingMiles: clampNonNeg(startingMiles),
        oneWayMiles: owm,
        returnMiles: rtm,
        didFastCharge: didFastCharge && isDriveDay,
        fastChargeMiles: (didFastCharge && isDriveDay) ? fastChargeMiles : 0,
        remainingMiles,
        overnightChargeMiles: clampNonNeg(overnightMiles),
        nextStartingMiles,
      });

      startingMiles = nextStartingMiles;
    }

    return rowsOut;
  }, [
    canPlug,
    level,
    fullRange,
    reserveMiles,
    overnightMiles,
    scheduleDays,
    drivingDays,
    oneWayMiles,
    returnMiles,
    fastChargeDays,
  ]);

  const totals = useMemo(() => {
    const weeklyNeed = milesPerDay * drivingDays;
    // “Home supply” here is NOT just overnightMiles*7, because you might hit 0 and need fast charging.
    // So we compute a “deficit signal” from the schedule:
    const last = rows[rows.length - 1];
    const endedWith = last ? last.nextStartingMiles : fullRange;

    // A simple indicator: how many days ended at 0 remaining (after reserve).
    const zeroDays = rows.filter((r) => r.remainingMiles === 0 && (r.oneWayMiles + r.returnMiles) > 0).length;

    return { weeklyNeed, endedWith, zeroDays };
  }, [rows, milesPerDay, drivingDays, fullRange]);

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

    // Keep your existing heuristic language, but base it on milesPerDay (per driving day).
    if (level === "L1") {
      if (milesPerDay <= 50) {
        return {
          badge: "READY (L1)",
          title: "✅ EV Ready (Level 1 works)",
          color: "text-green-300",
          subtitle: "Your driving fits overnight Level 1 charging.",
          body: "If you can plug in 8–10 hours overnight, Level 1 can cover most of your routine.",
        };
      }
      if (milesPerDay <= 120) {
        return {
          badge: "READY + PLAN",
          title: "🟠 EV Ready (with a plan)",
          color: "text-orange-300",
          subtitle: "Level 1 is doable, but you’ll need support charging.",
          body:
            "You’ll likely need occasional fast charging OR plug in where you go (work/errands) to stay comfortable.",
        };
      }
      return {
        badge: "FAST-CHARGE DEPENDENT",
        title: "🚨 High Friction Risk (Level 1)",
        color: "text-red-400",
        subtitle: "Level 1 won’t keep up with this driving pattern.",
        body:
          "At this mileage, you’ll depend on fast charging frequently unless you upgrade to Level 2.",
      };
    }

    if (level === "L2") {
      if (milesPerDay <= 200) {
        return {
          badge: "LEVEL 3",
          title: "✅ EV Ready",
          color: "text-green-300",
          subtitle: "Level 2 + your driving pattern is a strong fit.",
          body:
            "Overnight Level 2 turns charging into an appliance-like routine: drive → park → plug → repeat.",
        };
      }
      return {
        badge: "LEVEL 2+",
        title: "✅ Likely Ready (with planning)",
        color: "text-yellow-300",
        subtitle: "You’re driving a lot—have backups for heavy weeks.",
        body:
          "You’ll want a dependable fast-charge fallback for heavy days and road trips. Reliability matters more than speed.",
      };
    }

    return null;
  }, [canPlug, level, milesPerDay]);

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
          {/* Q1 */}
          {step === "Q1" && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                When you get home at night, can you plug in where you park?
              </h2>
              <p className="text-gray-400 mt-3">
                This is your biggest readiness lever. Overnight access changes everything.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                <BigChoice label="Yes" sub="I can plug in overnight." onClick={() => onQ1("yes")} />
                <BigChoice
                  label="No"
                  sub="I can’t reliably plug in at night."
                  onClick={() => onQ1("no")}
                />
              </div>
            </div>
          )}

          {/* Q2 */}
          {step === "Q2" && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">What kind of plug is it?</h2>
              <p className="text-gray-400 mt-3">
                Level 1 = standard 120V outlet (~3–5 miles/hour). Level 2 = dedicated faster charging.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                <BigChoice
                  label="Level 1 (120V)"
                  sub="Standard household outlet."
                  onClick={() => onQ2("L1")}
                />
                <BigChoice
                  label="Level 2"
                  sub="Dedicated EV charging / 240V."
                  onClick={() => onQ2("L2")}
                />
              </div>

              <button onClick={() => setStep("Q1")} className="mt-6 text-sm text-gray-400 hover:text-white">
                ← Back
              </button>
            </div>
          )}

          {/* Inputs + Spreadsheet Schedule */}
          {showMiles && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">What’s your driving pattern?</h2>
              <p className="text-gray-400 mt-3">
                We’ll calculate your week using “sheet logic” (fast charge resets to full after outbound).
              </p>

              {/* Miles per driving day */}
              <div className="mt-8 p-5 rounded-2xl bg-black/35 border border-white/10">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-400">Miles per driving day</span>
                  <span className="text-3xl font-bold">{milesPerDay}</span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={250}
                  step={5}
                  value={milesPerDay}
                  onChange={(e) => setMilesPerDay(Number(e.target.value))}
                  className="w-full mt-5"
                />

                <p className="mt-3 text-sm text-gray-400">
                  We split this into a round trip: {oneWayMiles} out + {returnMiles} back.
                </p>
              </div>

              {/* Driving days per week */}
              <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-400">Driving days per week</span>
                  <span className="text-3xl font-bold">{drivingDays}</span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={7}
                  step={1}
                  value={drivingDays}
                  onChange={(e) => setDrivingDays(Number(e.target.value))}
                  className="w-full mt-5"
                />

                <p className="mt-3 text-sm text-gray-400">
                  Weekly miles = {milesPerDay} × {drivingDays} ={" "}
                  <span className="text-gray-200 font-semibold">{totals.weeklyNeed}</span>
                </p>
              </div>

              {/* Range + reserve */}
              <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-400">Full range when charged</span>
                  <span className="text-3xl font-bold">{fullRange}</span>
                </div>

                <input
                  type="range"
                  min={150}
                  max={400}
                  step={10}
                  value={fullRange}
                  onChange={(e) => setFullRange(Number(e.target.value))}
                  className="w-full mt-5"
                />

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-sm text-gray-400">Reserve miles</span>
                  <span className="text-lg font-semibold">{reserveMiles}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={reserveMiles}
                  onChange={(e) => setReserveMiles(Number(e.target.value))}
                  className="w-full mt-3"
                />

                <p className="mt-3 text-sm text-gray-400">
                  Overnight adds about{" "}
                  <span className="text-gray-200 font-semibold">{clampNonNeg(overnightMiles)}</span>{" "}
                  miles ({level === "L1" ? "Level 1" : "Level 2"}).
                </p>
              </div>

              {/* Fast charge days */}
              <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10">
                <label className="block text-sm text-gray-300 mb-2">
                  Fast charge day indices (0–6), comma-separated
                </label>
                <input
                  value={fastChargeDaysInput}
                  onChange={(e) => setFastChargeDaysInput(e.target.value)}
                  placeholder="e.g., 2,4 (fast charge on Wed and Fri)"
                  className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-gray-200 outline-none focus:border-white/25"
                />
                <p className="mt-2 text-sm text-gray-400">
                  Fast charge happens <span className="text-gray-200">after outbound</span> and resets to full range.
                </p>
              </div>

              {/* Schedule Table */}
              <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
                <table className="min-w-[760px] w-full border-collapse">
                  <thead className="bg-black/30">
                    <tr>
                      {["Day", "Start", "Out", "Back", "Fast", "Remain", "Overnight", "Next"].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs tracking-widest text-gray-400 px-4 py-3 border-b border-white/10"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.dayIndex} className="border-b border-white/5">
                        <td className="px-4 py-3 text-sm text-gray-200">{r.label}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.startingMiles}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.oneWayMiles}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.returnMiles}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">
                          {r.didFastCharge ? r.fastChargeMiles : ""}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.remainingMiles}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.overnightChargeMiles}</td>
                        <td className="px-4 py-3 text-sm text-gray-200">{r.nextStartingMiles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Quick insight summary from schedule */}
              <div className="mt-5 p-4 rounded-2xl bg-black/30 border border-white/10 text-sm text-gray-300">
                <p>
                  Weekly miles driven: <span className="text-gray-100 font-semibold">{totals.weeklyNeed}</span>
                </p>
                <p>
                  Week ends at: <span className="text-gray-100 font-semibold">{totals.endedWith}</span> miles (after overnight).
                </p>
                {totals.zeroDays > 0 ? (
                  <p className="mt-2 text-yellow-300">
                    You hit the reserve floor on {totals.zeroDays} drive day(s). Add fast-charge days or increase overnight charging.
                  </p>
                ) : (
                  <p className="mt-2 text-green-400">
                    Your schedule stays above reserve all week with this charging plan.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                <button
                  onClick={() => setStep("RESULT")}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-white/10 hover:bg-white/15 transition p-4 font-semibold"
                >
                  Show my result
                </button>

                <button
                  onClick={() => setStep("Q2")}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-4 font-semibold"
                >
                  ← Change plug type
                </button>
              </div>
            </div>
          )}

          {/* Result */}
          {showResult && result && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <div className="flex items-center justify-between gap-3 mb-4">
                <span className="text-xs tracking-widest text-gray-400 border border-white/10 px-3 py-1 rounded-full">
                  {result.badge}
                </span>
              </div>

              <h2 className={`text-3xl sm:text-4xl font-bold ${result.color}`}>{result.title}</h2>
              <p className="text-gray-200 mt-3 text-lg">{result.subtitle}</p>

              <div className="mt-5 p-5 rounded-2xl bg-black/35 border border-white/10">
                <p className="text-sm text-gray-400 mb-2">What this means</p>
                <p className="text-gray-200">{result.body}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                <button
                  onClick={reset}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-4 font-semibold"
                >
                  Start over
                </button>

                <button
                  onClick={() => setStep(level ? "MILES" : "Q2")}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-white/10 hover:bg-white/15 transition p-4 font-semibold"
                >
                  ← Adjust my inputs
                </button>
              </div>
            </div>
          )}
        </div>

        <style jsx global>{`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(6px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    </main>
  );
}

function BigChoice({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-5 text-left"
    >
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{label}</span>
        <span className="text-gray-400 group-hover:text-gray-200 transition">↳</span>
      </div>
      <p className="text-sm text-gray-400 mt-2">{sub}</p>
    </button>
  );
}

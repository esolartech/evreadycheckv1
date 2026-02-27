"use client";

import { useMemo, useState } from "react";

type Step = "Q1" | "Q2" | "MILES" | "RESULT";
type PlugAnswer = "yes" | "no" | null;
type ChargeLevel = "L1" | "L2" | null;

function calcChargePlan(opts: {
  milesPerDrivingDay: number;
  drivingDaysPerWeek: number;
  homeLevel: "L1" | "L2";
  overnightHours?: number; // default 9
  l1MilesPerHour?: number; // default 4 (3–5)
  l2MilesPerHour?: number; // default 25 (20–30)
  fastSessionMiles?: number; // default 120 (top-up model)
  publicL2SessionMiles?: number; // default 60
  nightsPerWeekPluggedIn?: number; // default 7
}) {
  const {
    milesPerDrivingDay,
    drivingDaysPerWeek,
    homeLevel,
    overnightHours = 9,
    l1MilesPerHour = 4,
    l2MilesPerHour = 25,
    fastSessionMiles = 120,
    publicL2SessionMiles = 60,
    nightsPerWeekPluggedIn = 7,
  } = opts;

  const mph = homeLevel === "L1" ? l1MilesPerHour : l2MilesPerHour;

  const overnightMiles = mph * overnightHours;

  // weekly driving need is miles * driving days (NOT 7 anymore)
  const weeklyNeed = milesPerDrivingDay * drivingDaysPerWeek;

  // weekly home supply: you can add overnightMiles per night you plug in,
  // but you can't "use" more than your weekly need.
  const weeklyHomeSupply = Math.min(weeklyNeed, overnightMiles * nightsPerWeekPluggedIn);

  const weeklyShortfall = Math.max(0, weeklyNeed - weeklyHomeSupply);

  const fastSessionsPerWeek =
    weeklyShortfall === 0 ? 0 : Math.ceil(weeklyShortfall / fastSessionMiles);

  const publicL2SessionsPerWeek =
    weeklyShortfall === 0 ? 0 : Math.ceil(weeklyShortfall / publicL2SessionMiles);

  return {
    overnightMiles: Math.round(overnightMiles),
    weeklyNeed: Math.round(weeklyNeed),
    weeklyHomeSupply: Math.round(weeklyHomeSupply),
    weeklyShortfall: Math.round(weeklyShortfall),
    fastSessionsPerWeek,
    publicL2SessionsPerWeek,
  };
}

function calcFullResetPlan(opts: {
  milesPerDrivingDay: number;
  drivingDaysPerWeek: number;
  homeLevel: "L1" | "L2";
  fullRangeMiles: number;
  reserveMiles?: number; // default 10
  overnightHours?: number; // default 9
  l1MilesPerHour?: number; // default 4
  l2MilesPerHour?: number; // default 25
  fastResetToPct?: number; // default 1.0 (back to full)
  nightsPerWeekPluggedIn?: number; // default 7
}) {
  const {
    milesPerDrivingDay,
    drivingDaysPerWeek,
    homeLevel,
    fullRangeMiles,
    reserveMiles = 10,
    overnightHours = 9,
    l1MilesPerHour = 4,
    l2MilesPerHour = 25,
    fastResetToPct = 1.0,
    nightsPerWeekPluggedIn = 7,
  } = opts;

  const mph = homeLevel === "L1" ? l1MilesPerHour : l2MilesPerHour;
  const overnightAdd = mph * overnightHours;

  // Weekly miles
  const weeklyNeed = milesPerDrivingDay * drivingDaysPerWeek;

  // If no driving, no resets needed
  if (weeklyNeed <= 0) {
    return {
      overnightAdd: Math.round(overnightAdd),
      reserveMiles,
      daysPerFullTank: 0,
      fastResetsPerWeek: 0,
      weeklyNeed: 0,
    };
  }

  // Simulate a “week” as a sequence of driving days + non-driving days.
  // We'll model driving days first, then non-driving days.
  // This is simple but effective for planning.
  let socMiles = fullRangeMiles;
  let fastResetsPerWeek = 0;

  const totalDays = 7;
  const nonDrivingDays = Math.max(0, totalDays - drivingDaysPerWeek);

  // Helper: apply overnight charging if you plug in that night
  let nightsRemaining = nightsPerWeekPluggedIn;

  const applyOvernight = () => {
    if (nightsRemaining > 0) {
      socMiles = Math.min(fullRangeMiles, socMiles + overnightAdd);
      nightsRemaining -= 1;
    }
  };

  // Drive days
  for (let i = 0; i < drivingDaysPerWeek; i++) {
    socMiles -= milesPerDrivingDay;

    if (socMiles < reserveMiles) {
      fastResetsPerWeek += 1;
      socMiles = Math.max(socMiles, fullRangeMiles * fastResetToPct);
    }

    applyOvernight();
  }

  // Non-driving days (still can charge overnight)
  for (let i = 0; i < nonDrivingDays; i++) {
    applyOvernight();
  }

  // "Days per full tank" (approx) using *average daily miles* across 7 days
  const avgDailyMiles = weeklyNeed / 7;
  const daysPerFullTank =
    (fullRangeMiles - reserveMiles) / Math.max(avgDailyMiles, 1);

  return {
    overnightAdd: Math.round(overnightAdd),
    reserveMiles,
    daysPerFullTank: Number(daysPerFullTank.toFixed(1)),
    fastResetsPerWeek,
    weeklyNeed: Math.round(weeklyNeed),
  };
}

export default function EVReadyWizard() {
  const [step, setStep] = useState<Step>("Q1");
  const [canPlug, setCanPlug] = useState<PlugAnswer>(null);
  const [level, setLevel] = useState<ChargeLevel>(null);

  // sliders
  const [milesPerDay, setMilesPerDay] = useState<number>(140);
  const [drivingDays, setDrivingDays] = useState<number>(5);
  const [fullRange, setFullRange] = useState<number>(260);

  const reset = () => {
    setStep("Q1");
    setCanPlug(null);
    setLevel(null);
    setMilesPerDay(140);
    setDrivingDays(5);
    setFullRange(260);
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

  const plan =
    canPlug === "yes" && level
      ? calcChargePlan({
          milesPerDrivingDay: milesPerDay,
          drivingDaysPerWeek: drivingDays,
          homeLevel: level,
          overnightHours: 9,
          nightsPerWeekPluggedIn: 7, // assume you plug in nightly when home
        })
      : null;

  const resetPlan =
    canPlug === "yes" && level
      ? calcFullResetPlan({
          milesPerDrivingDay: milesPerDay,
          drivingDaysPerWeek: drivingDays,
          homeLevel: level,
          fullRangeMiles: fullRange,
          reserveMiles: 10,
          fastResetToPct: 1.0, // “fast charge puts you back to full”
          nightsPerWeekPluggedIn: 7,
        })
      : null;

  const weeklyMiles = useMemo(() => milesPerDay * drivingDays, [milesPerDay, drivingDays]);

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

    // your original thresholds were written as “daily”, but now we have driving days.
    // We’ll interpret the threshold using miles-per-driving-day (most intuitive for users).
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
            "You’ll likely need occasional fast charging OR workplace/public Level 2 to stay comfortable.",
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
          subtitle: "Level 2 + under ~200 miles per driving day is a strong fit.",
          body: "Overnight Level 2 turns charging into an appliance-like routine.",
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

  const showResult = step === "RESULT";
  const showMiles = step === "MILES";

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

          {/* Sliders */}
          {showMiles && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                What’s your driving pattern?
              </h2>
              <p className="text-gray-400 mt-3">
                We’ll calculate your weekly shortfall based on miles × driving days.
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
                  Weekly miles = {milesPerDay} × {drivingDays} ={" "}
                  <span className="text-gray-200 font-semibold">{weeklyMiles}</span>
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
                  If you drive 140 miles for 5 days/week, set miles = 140 and days = 5.
                </p>
              </div>

              {/* Full range slider */}
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

                <p className="mt-3 text-sm text-gray-400">
                  Used to estimate how often you need a full-range reset (10 mi reserve).
                </p>
              </div>

              {/* Plan output */}
              {plan && (
                <div className="mt-6 p-4 rounded-xl bg-black/30 border border-white/10 text-sm text-gray-300">
                  <p>Overnight you can add ~{plan.overnightMiles} miles.</p>
                  <p>Weekly miles driven: ~{plan.weeklyNeed} miles.</p>
                  <p>Weekly home supply: ~{plan.weeklyHomeSupply} miles.</p>

                  {plan.weeklyShortfall === 0 ? (
                    <p className="mt-2 text-green-400">
                      Your overnight charging fully covers your weekly driving.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2">Weekly shortfall: ~{plan.weeklyShortfall} miles</p>
                      <p className="text-gray-400 mt-1">
                        (Top-up model) Fast charging: ~{plan.fastSessionsPerWeek} session(s)/week
                      </p>
                      <p className="text-gray-400">
                        (Top-up model) Public/Work Level 2: ~{plan.publicL2SessionsPerWeek} session(s)/week
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Reset-to-full output */}
              {resetPlan && (
                <div className="mt-4 p-4 rounded-xl bg-black/30 border border-white/10 text-sm text-gray-300">
                  <p>Overnight adds ~{resetPlan.overnightAdd} miles.</p>
                  <p>Weekly miles driven: ~{resetPlan.weeklyNeed} miles.</p>
                  <p>
                    Full charge lasts ~{resetPlan.daysPerFullTank} day(s) on average (10 mi reserve).
                  </p>
                  <p className="mt-2">
                    Full-range resets needed:{" "}
                    <span className="font-semibold">{resetPlan.fastResetsPerWeek}</span> fast charge
                    session(s) per week
                  </p>
                </div>
              )}

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

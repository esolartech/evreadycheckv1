"use client";

import React, { useMemo, useState } from "react";

/** Charging plan math */
function calcChargePlan(opts: {
  weekdayMilesPerDrivingDay: number;
  weekdayDrivingDaysPerWeek: number;
  weekendMilesTotal: number;
  homeLevel: "L1" | "L2";
  weekdayOvernightHours?: number;
  weekendOvernightHours?: number;
  l1MilesPerHour?: number;
  l2MilesPerHour?: number;
  weekdayNightsPluggedIn?: number;
  weekendNightsPluggedIn?: number;
}) {
  const {
    weekdayMilesPerDrivingDay,
    weekdayDrivingDaysPerWeek,
    weekendMilesTotal,
    homeLevel,
    weekdayOvernightHours = 9,
    weekendOvernightHours = 16,
    l1MilesPerHour = 4,
    l2MilesPerHour = 25,
    weekdayNightsPluggedIn = 5,
    weekendNightsPluggedIn = 2,
  } = opts;

  const mph = homeLevel === "L1" ? l1MilesPerHour : l2MilesPerHour;

  const weekdayOvernightMiles = mph * weekdayOvernightHours;
  const weekendOvernightMiles = mph * weekendOvernightHours;

  const weekdayNeed = weekdayMilesPerDrivingDay * weekdayDrivingDaysPerWeek;
  const weeklyNeed = weekdayNeed + weekendMilesTotal;

  const theoreticalSupply =
    weekdayOvernightMiles * weekdayNightsPluggedIn +
    weekendOvernightMiles * weekendNightsPluggedIn;

  const weeklyHomeSupply = Math.min(weeklyNeed, theoreticalSupply);
  const weeklyShortfall = Math.max(0, weeklyNeed - weeklyHomeSupply);

  return {
    mph: Math.round(mph),
    weeklyNeed: Math.round(weeklyNeed),
    weeklyHomeSupply: Math.round(weeklyHomeSupply),
    weeklyShortfall: Math.round(weeklyShortfall),
  };
}

/** Full-reset fast-charge sessions */
function calcFastChargeSessionsForShortfall(
  weeklyShortfallMiles: number,
  fullRangeMiles: number,
  reserveMiles = 10
) {
  const usablePerSession = Math.max(1, fullRangeMiles - reserveMiles);
  if (weeklyShortfallMiles <= 0) return 0;
  return Math.ceil(weeklyShortfallMiles / usablePerSession);
}

function SliderCard({
  title,
  valueRight,
  children,
}: {
  title: string;
  valueRight: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-gray-400">{title}</span>
        <span className="text-3xl font-bold">{valueRight}</span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
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
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-5 text-left"
    >
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold">{label}</span>
        <span className="text-gray-400 group-hover:text-gray-200 transition">
          ↳
        </span>
      </div>
      <p className="text-sm text-gray-400 mt-2">{sub}</p>
    </button>
  );
}

export default function EVReadyWizard() {
  const [step, setStep] = useState<"Q1" | "Q2" | "MILES" | "PLAN">("Q1");
  const [canPlug, setCanPlug] = useState<"yes" | "no" | null>(null);
  const [level, setLevel] = useState<"L1" | "L2" | null>(null);

  const [fullRange, setFullRange] = useState(260);
  const [weekdayMilesPerDay, setWeekdayMilesPerDay] = useState(140);
  const [weekdayDrivingDays, setWeekdayDrivingDays] = useState(5);
  const [weekendMiles, setWeekendMiles] = useState(20);
  const [weekendChargeHours, setWeekendChargeHours] = useState(16);
  const [milesPerKwh, setMilesPerKwh] = useState(3.0);

  const weekdayChargeHours = 9;
  const reserveMiles = 10;

  const [showFinalResult, setShowFinalResult] = useState(false);

  const reset = () => {
    setStep("Q1");
    setCanPlug(null);
    setLevel(null);
    setShowFinalResult(false);

    setFullRange(260);
    setWeekdayMilesPerDay(140);
    setWeekdayDrivingDays(5);
    setWeekendMiles(20);
    setWeekendChargeHours(16);
    setMilesPerKwh(3.0);
  };

  const estBatteryKwh = useMemo(() => {
    return Number((fullRange / Math.max(milesPerKwh, 0.1)).toFixed(1));
  }, [fullRange, milesPerKwh]);

  const plan =
    canPlug === "yes" && level
      ? calcChargePlan({
          weekdayMilesPerDrivingDay: weekdayMilesPerDay,
          weekdayDrivingDaysPerWeek: weekdayDrivingDays,
          weekendMilesTotal: weekendMiles,
          homeLevel: level,
          weekdayOvernightHours: weekdayChargeHours,
          weekendOvernightHours: weekendChargeHours,
          weekdayNightsPluggedIn: 5,
          weekendNightsPluggedIn: 2,
        })
      : null;

  const fastChargeSessions =
    plan && canPlug === "yes"
      ? calcFastChargeSessionsForShortfall(
          plan.weeklyShortfall,
          fullRange,
          reserveMiles
        )
      : 0;

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

    const routineMiles = weekdayMilesPerDay;

    if (level === "L1") {
      if (routineMiles <= 50) {
        return {
          badge: "READY (L1)",
          title: "✅ EV Ready (Level 1 works)",
          color: "text-green-300",
          subtitle: "Your weekday routine fits Level 1.",
          body: "With a consistent plug, Level 1 can cover most low-mileage routines.",
        };
      }
      if (routineMiles <= 120) {
        return {
          badge: "READY + PLAN",
          title: "🟠 EV Ready (with a plan)",
          color: "text-orange-300",
          subtitle: "Level 1 can work, but you’ll need backup charging.",
          body: "Expect occasional fast charging or public/work Level 2 when you have heavier weeks.",
        };
      }
      return {
        badge: "FAST-CHARGE DEPENDENT",
        title: "🚨 High Friction Risk (Level 1)",
        color: "text-red-400",
        subtitle: "Level 1 won’t keep up with this weekday pattern.",
        body: "At this mileage, you’ll depend on fast charging frequently unless you upgrade to Level 2.",
      };
    }

    if (routineMiles <= 200) {
      return {
        badge: "LEVEL 3",
        title: "✅ EV Ready",
        color: "text-green-300",
        subtitle: "Level 2 + a normal weekday routine is a strong fit.",
        body: "Overnight Level 2 turns charging into an appliance-like routine.",
      };
    }

    return {
      badge: "LEVEL 2+",
      title: "✅ Likely Ready (with planning)",
      color: "text-yellow-300",
      subtitle: "You’re driving a lot—have backups for heavy weeks.",
      body: "You’ll want a dependable fast-charge fallback for heavy days and road trips.",
    };
  }, [canPlug, level, weekdayMilesPerDay]);

  const onQ1 = (ans: "yes" | "no") => {
    setCanPlug(ans);
    setShowFinalResult(false);
    setStep(ans === "no" ? "PLAN" : "Q2");
  };

  const onQ2 = (ans: "L1" | "L2") => {
    setLevel(ans);
    setShowFinalResult(false);
    setStep("MILES");
  };

  const showMiles = step === "MILES";
  const showPlan = step === "PLAN";

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(34,197,94,0.10),transparent_45%)]" />

      <div className="max-w-2xl mx-auto px-5 py-10">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              areyouready4anEV
            </h1>
            <p className="text-gray-400 mt-2">
              Range isn’t the hard part.{" "}
              <span className="text-gray-200">Charging fit</span> is.
            </p>
          </div>

          <button
            type="button"
            onClick={reset}
            className="text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 px-3 py-2 rounded-lg"
          >
            Reset
          </button>
        </div>

        <div className="bg-gray-900/70 backdrop-blur border border-white/10 rounded-2xl p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
          {step === "Q1" && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                When you get home at night, can you plug in where you park?
              </h2>
              <p className="text-gray-400 mt-3">
                This is your biggest readiness lever. Overnight access changes
                everything.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                <BigChoice
                  label="Yes"
                  sub="I can plug in overnight."
                  onClick={() => onQ1("yes")}
                />
                <BigChoice
                  label="No"
                  sub="I can’t reliably plug in at night."
                  onClick={() => onQ1("no")}
                />
              </div>
            </div>
          )}

          {step === "Q2" && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                What kind of plug is it?
              </h2>
              <p className="text-gray-400 mt-3">
                Level 1 = standard 120V outlet (~3–5 miles/hour). Level 2 =
                dedicated faster charging.
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

              <button
                type="button"
                onClick={() => setStep("Q1")}
                className="mt-6 text-sm text-gray-400 hover:text-white"
              >
                ← Back
              </button>
            </div>
          )}

          {showMiles && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                What’s your driving pattern?
              </h2>
              <p className="text-gray-400 mt-3">
                We’ll calculate weekday + weekend miles and account for longer
                weekend charging.
              </p>

              <SliderCard title="Full range when charged" valueRight={fullRange}>
                <div className="text-xs text-gray-400 mb-3">
                  Estimated battery size:{" "}
                  <span className="text-gray-200 font-semibold">
                    {estBatteryKwh} kWh
                  </span>
                </div>
                <input
                  type="range"
                  min={150}
                  max={400}
                  step={10}
                  value={fullRange}
                  onChange={(e) => setFullRange(Number(e.target.value))}
                  className="w-full"
                />
              </SliderCard>

              <SliderCard
                title="Efficiency (miles per kWh)"
                valueRight={milesPerKwh.toFixed(1)}
              >
                <input
                  type="range"
                  min={2.0}
                  max={4.5}
                  step={0.1}
                  value={milesPerKwh}
                  onChange={(e) => setMilesPerKwh(Number(e.target.value))}
                  className="w-full"
                />
                
              </SliderCard>
              
              <SliderCard
                title="Weekday miles per driving day (Mon–Fri)"
                valueRight={weekdayMilesPerDay}
              >
                <input
                  type="range"
                  min={0}
                  max={250}
                  step={5}
                  value={weekdayMilesPerDay}
                  onChange={(e) => setWeekdayMilesPerDay(Number(e.target.value))}
                  className="w-full"
                />
              </SliderCard>

              <SliderCard
                title="Weekday Driving (Mon–Fri)"
                valueRight={weekdayDrivingDays}
              >
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={weekdayDrivingDays}
                  onChange={(e) => setWeekdayDrivingDays(Number(e.target.value))}
                  className="w-full"
                />
              </SliderCard>

              <SliderCard title="Weekend miles" valueRight={weekendMiles}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={weekendMiles}
                  onChange={(e) => setWeekendMiles(Number(e.target.value))}
                  className="w-full"
                />
              </SliderCard>

              <SliderCard
                title="Weekend charging hours"
                valueRight={weekendChargeHours}
              >
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={weekendChargeHours}
                  onChange={(e) => setWeekendChargeHours(Number(e.target.value))}
                  className="w-full"
                />
              </SliderCard>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                <button
                  type="button"
                  disabled={!plan}
                  onClick={() => setStep("PLAN")}
                  className={`rounded-2xl border border-white/10 transition p-4 font-semibold
                    ${
                      plan
                        ? "hover:border-white/25 bg-white/10 hover:bg-white/15"
                        : "opacity-50 cursor-not-allowed bg-white/5"
                    }`}
                >
                  Next →
                </button>

                <button
                  type="button"
                  onClick={() => setStep("Q2")}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-4 font-semibold"
                >
                  ← Change plug type
                </button>
              </div>
            </div>
          )}

          {showPlan && (
            <div className="animate-[fadeIn_240ms_ease-out]">
              <h2 className="text-2xl sm:text-3xl font-semibold leading-tight">
                Here’s your weekly charging math
              </h2>

              <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10 text-sm text-gray-300">
                {plan ? (
                  <>
                    <p>Charging speed: ~{plan.mph} miles/hour.</p>
                    <p>Weekly miles driven: ~{plan.weeklyNeed} miles.</p>
                    <p>Weekly home supply: ~{plan.weeklyHomeSupply} miles.</p>
                    <p>Weekly shortfall: ~{plan.weeklyShortfall} miles.</p>
                    <p className="mt-4">
                      <span className="text-gray-200 font-semibold">
                        Fast charge: {fastChargeSessions} session(s) / week
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-gray-400">
                    Set your inputs first (and choose a plug type).
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                <button
                  type="button"
                  disabled={!result}
                  onClick={() => setShowFinalResult(true)}
                  className={`rounded-2xl border border-white/10 transition p-4 font-semibold
                    ${
                      result
                        ? "hover:border-white/25 bg-white/10 hover:bg-white/15"
                        : "opacity-50 cursor-not-allowed bg-white/5"
                    }`}
                >
                  Show my result ↓
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowFinalResult(false);
                    setStep("MILES");
                  }}
                  className="rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-4 font-semibold"
                >
                  ← Back to sliders
                </button>
              </div>

              {showFinalResult && result && (
                <div className="mt-8">
                  <span className="text-xs tracking-widest text-gray-400 border border-white/10 px-3 py-1 rounded-full">
                    {result.badge}
                  </span>

                  <h2 className={`mt-4 text-3xl sm:text-4xl font-bold ${result.color}`}>
                    {result.title}
                  </h2>
                  <p className="text-gray-200 mt-3 text-lg">{result.subtitle}</p>

                  <div className="mt-5 p-5 rounded-2xl bg-black/35 border border-white/10">
                    <p className="text-sm text-gray-400 mb-2">What this means</p>
                    <p className="text-gray-200">{result.body}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-2xl border border-white/10 hover:border-white/25 bg-black/30 hover:bg-black/40 transition p-4 font-semibold"
                    >
                      Start over
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowFinalResult(false);
                        setStep("MILES");
                      }}
                      className="rounded-2xl border border-white/10 hover:border-white/25 bg-white/10 hover:bg-white/15 transition p-4 font-semibold"
                    >
                      ← Adjust my inputs
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

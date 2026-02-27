"use client";

import React, { useMemo, useState } from "react";

// --- Types & Helpers ---
type Step = "Q1" | "Q2" | "MILES" | "PLAN";
type PlugAnswer = "yes" | "no" | null;
type ChargeLevel = "L1" | "L2" | null;

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

function calcFastChargeSessionsForShortfall(opts: {
  weeklyShortfallMiles: number;
  fullRangeMiles: number;
  reserveMiles?: number;
}) {
  const { weeklyShortfallMiles, fullRangeMiles, reserveMiles = 10 } = opts;
  const usablePerSession = Math.max(1, fullRangeMiles - reserveMiles);
  if (weeklyShortfallMiles <= 0) return 0;
  return Math.ceil(weeklyShortfallMiles / usablePerSession);
}

// --- Sub-Components ---
function SliderCard({ title, valueRight, children }: { title: string; valueRight: React.ReactNode; children: React.ReactNode }) {
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

function BigChoice({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
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

// --- Main Component ---
export default function EVReadyWizard() {
  const [step, setStep] = useState<Step | "RESULT">("Q1");
  const [canPlug, setCanPlug] = useState<PlugAnswer>(null);
  const [level, setLevel] = useState<ChargeLevel>(null);
  const [showFinalResult, setShowFinalResult] = useState(false);

  // Inputs
  const [fullRange, setFullRange] = useState<number>(260);
  const [weekdayMilesPerDay, setWeekdayMilesPerDay] = useState<number>(140);
  const [weekdayDrivingDays, setWeekdayDrivingDays] = useState<number>(5);
  const [weekendMiles, setWeekendMiles] = useState<number>(20);
  const [weekendChargeHours, setWeekendChargeHours] = useState<number>(16);
  const [milesPerKwh, setMilesPerKwh] = useState<number>(3.0);

  const weekdayChargeHours = 9;
  const reserveMiles = 10;

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

  const plan = useMemo(() => {
    if (canPlug === "yes" && level) {
      return calcChargePlan({
        weekdayMilesPerDrivingDay: weekdayMilesPerDay,
        weekdayDrivingDaysPerWeek: weekdayDrivingDays,
        weekendMilesTotal: weekendMiles,
        homeLevel: level,
        weekdayOvernightHours: weekdayChargeHours,
        weekendOvernightHours: weekendChargeHours,
      });
    }
    return null;
  }, [canPlug, level, weekdayMilesPerDay, weekdayDrivingDays, weekendMiles, weekendChargeHours]);

  const fastChargeSessions = useMemo(() => {
    if (!plan) return 0;
    return calcFastChargeSessionsForShortfall({
      weeklyShortfallMiles: plan.weeklyShortfall,
      fullRangeMiles: fullRange,
      reserveMiles,
    });
  }, [plan, fullRange]);

  const result = useMemo(() => {
    if (canPlug === "no") {
      return {
        badge: "LEVEL 0",
        title: "⚠️ Not Ready Yet",
        color: "text-red-400",
        subtitle: "No overnight plug = high friction risk.",
        body: "Before buying, secure a consistent charging anchor: home parking access, workplace charging, or a reliable Level 2 near your routine.",
      };
    }
    if (!level || !plan) return null;

    const routineMiles = weekdayMilesPerDay;
    if (level === "L1") {
      if (routineMiles <= 50) return { badge: "READY (L1)", title: "✅ EV Ready", color: "text-green-300", subtitle: "Level 1 works.", body: "Level 1 can cover low-mileage routines." };
      if (routineMiles <= 120) return { badge: "READY + PLAN", title: "🟠 EV Ready (with a plan)", color: "text-orange-300", subtitle: "Expect occasional fast charging.", body: "Level 1 covers most, but you'll need public charging for heavy weeks." };
      return { badge: "FAST-CHARGE DEPENDENT", title: "🚨 High Friction Risk", color: "text-red-400", subtitle: "Level 1 is too slow.", body: "You'll be fast-charging constantly. Consider a Level 2 upgrade." };
    }

    if (level === "L2") {
      if (routineMiles <= 200) return { badge: "LEVEL 2 READY", title: "✅ EV Ready", color: "text-green-300", subtitle: "Strong fit.", body: "Overnight Level 2 turns charging into an appliance-like routine." };
      return { badge: "LEVEL 2+", title: "✅ Likely Ready", color: "text-yellow-300", subtitle: "High mileage user.", body: "You're driving a lot—have a fast-charge fallback for extreme days." };
    }
    return null;
  }, [canPlug, level, weekdayMilesPerDay, plan]);

  return (
    <main className="min-h-screen bg-black text-white relative">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(34,197,94,0.10),transparent_45%)]" />

      <div className="max-w-2xl mx-auto px-5 py-10">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">areyouready4anEV</h1>
            <p className="text-gray-400 mt-2">Range isn’t the hard part. <span className="text-gray-200">Charging fit</span> is.</p>
          </div>
          <button onClick={reset} className="text-sm text-gray-300 hover:text-white border border-white/10 px-3 py-2 rounded-lg">Reset</button>
        </div>

        <div className="bg-gray-900/70 backdrop-blur border border-white/10 rounded-2xl p-6 sm:p-8 shadow-xl">
          {step === "Q1" && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-semibold">Can you plug in where you park at night?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                <BigChoice label="Yes" sub="I can plug in overnight." onClick={() => { setCanPlug("yes"); setStep("Q2"); }} />
                <BigChoice label="No" sub="I can’t reliably plug in." onClick={() => { setCanPlug("no"); setStep("RESULT"); }} />
              </div>
            </div>
          )}

          {step === "Q2" && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-semibold">What kind of plug is it?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
                <BigChoice label="Level 1 (120V)" sub="Standard outlet." onClick={() => { setLevel("L1"); setStep("MILES"); }} />
                <BigChoice label="Level 2" sub="240V / Faster charging." onClick={() => { setLevel("L2"); setStep("MILES"); }} />
              </div>
              <button onClick={() => setStep("Q1")} className="mt-6 text-sm text-gray-400">← Back</button>
            </div>
          )}

          {step === "MILES" && (
            <div className="animate-in fade-in duration-300">
              <h2 className="text-2xl font-semibold">Your Driving Pattern</h2>
              <SliderCard title="Vehicle Range" valueRight={`${fullRange} mi`}>
                <input type="range" min={150} max={450} step={10} value={fullRange} onChange={(e) => setFullRange(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
              </SliderCard>
              <SliderCard title="Weekday Miles / Day" valueRight={weekdayMilesPerDay}>
                <input type="range" min={0} max={250} step={5} value={weekdayMilesPerDay} onChange={(e) => setWeekdayMilesPerDay(Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
              </SliderCard>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7">
                <button onClick={() => setStep("PLAN")} className="bg-white/10 p-4 rounded-2xl font-semibold">Next →</button>
                <button onClick={() => setStep("Q2")} className="bg-black/30 p-4 rounded-2xl font-semibold">← Back</button>
              </div>
            </div>
          )}

          {(step === "PLAN" || step === "RESULT") && (
            <div className="animate-in fade-in duration-300">
              {canPlug === "no" ? (
                <div className="mt-4">
                   <h2 className={`text-3xl font-bold ${result?.color}`}>{result?.title}</h2>
                   <p className="mt-4 text-gray-300">{result?.body}</p>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold">Weekly Charging Math</h2>
                  <div className="mt-6 p-5 rounded-2xl bg-black/35 border border-white/10 text-gray-300">
                    <p>Home Supply: {plan?.weeklyHomeSupply} mi/week</p>
                    <p>Demand: {plan?.weeklyNeed} mi/week</p>
                    <p className="mt-2 text-white font-bold">Shortfall: {plan?.weeklyShortfall} miles</p>
                    <p className="text-blue-400">Requires ~{fastChargeSessions} fast-charge stops</p>
                  </div>
                  
                  {!showFinalResult ? (
                    <button 
                        onClick={() => setShowFinalResult(true)} 
                        className="mt-6 w-full bg-white/10 p-4 rounded-2xl font-semibold border border-white/20"
                    >
                        Show my result ↓
                    </button>
                  ) : result && (
                    <div className="mt-8 pt-8 border-t border-white/10 animate-in slide-in-from-top-4 duration-500">
                        <span className="text-xs tracking-widest text-gray-400 border border-white/10 px-3 py-1 rounded-full">{result.badge}</span>
                        <h2 className={`text-3xl font-bold mt-4 ${result.color}`}>{result.title}</h2>
                        <p className="text-gray-200 mt-4">{result.body}</p>
                    </div>
                  )}
                  <button onClick={() => {setStep("MILES"); setShowFinalResult(false);}} className="mt-6 text-sm text-gray-400">← Back to sliders</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

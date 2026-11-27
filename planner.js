/**
 * Paddock Planner — pure planning logic for DOFUS 3.7 mount breeding.
 *
 * Rules source: Dofus pour les Noobs, "Guide de l'éleveur" (updated 2026-10-13)
 * and the 3.7 patch notes. Runs in the browser (window.Planner) and in Node
 * (module.exports).
 *
 * Unverified assumptions (calibrate against in-game observations):
 *   - serenity gauges move serenity at the same per-tier rate as other gauges;
 *   - serenity does not drift on its own.
 */
(function (root) {
  'use strict';

  /** Max value of endurance, maturity and love. A mount is fecund when all three reach it. */
  const STAT_MAX = 20000;
  const SERENITY_MIN = -5000;
  const SERENITY_MAX = 5000;
  const MAX_LEVEL = 200;

  /**
   * Paddock gauges. `serenity` is the direction a serenity gauge moves serenity;
   * `stat` is the mount stat a progress gauge raises.
   */
  const GAUGES = [
    { key: 'serenityDown', name: 'Serenity loss', game: 'Baffeur', color: '#7b4bb7', serenity: -1 },
    { key: 'serenityUp', name: 'Serenity gain', game: 'Caresseur', color: '#a77de0', serenity: 1 },
    { key: 'endurance', name: 'Endurance', game: 'Foudroyeur', color: '#d9a400', stat: 'endurance' },
    { key: 'maturity', name: 'Maturity', game: 'Abreuvoir', color: '#2b7bd6', stat: 'maturity' },
    { key: 'love', name: 'Love', game: 'Dragofesse', color: '#d6336c', stat: 'love' },
    { key: 'xp', name: 'Experience', game: 'Mangeoire', color: '#8a5a2b', stat: 'xp' },
  ];
  const GAUGE_BY_KEY = Object.fromEntries(GAUGES.map((g) => [g.key, g]));
  const BREEDING_STATS = ['endurance', 'maturity', 'love'];

  /** Gauge tier for a fuel amount (3.7 thresholds). Tier n gives n points per second. */
  const tier = (fuel) =>
    fuel <= 0 ? 0 : fuel <= 80000 ? 1 : fuel <= 140000 ? 2 : fuel <= 180000 ? 3 : 4;

  /** Whether a stat can grow at the given serenity. */
  const inZone = (stat, serenity) => {
    if (stat === 'endurance') return serenity <= -1;
    if (stat === 'maturity') return serenity >= -2000 && serenity <= 2000;
    if (stat === 'love') return serenity >= 0;
    return true;
  };

  const isFecund = (m) => BREEDING_STATS.every((s) => m[s] >= STAT_MAX);
  const needsGauges = (m) => m.status === 'fertile' && !isFecund(m);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /**
   * Serenity interval the mount should sit in next. Prefers the two "double"
   * zones where two stats grow at once: [-2000,-1] and [0,2000].
   */
  function targetZone(m) {
    const e = m.endurance < STAT_MAX;
    const ma = m.maturity < STAT_MAX;
    const l = m.love < STAT_MAX;
    const s = m.serenity;
    if (e && ma && l) return s < 0 ? [-2000, -1] : [0, 2000];
    if (e && ma) return [-2000, -1];
    if (ma && l) return [0, 2000];
    if (e && l) return s < 0 ? [SERENITY_MIN, -1] : [0, SERENITY_MAX];
    if (e) return [SERENITY_MIN, -1];
    if (l) return [0, SERENITY_MAX];
    if (ma) return [-2000, 2000];
    return null;
  }

  const distanceToZone = (s, zone) =>
    !zone ? 0 : s < zone[0] ? zone[0] - s : s > zone[1] ? s - zone[1] : 0;

  /** How much a mount benefits from a gauge right now (weighted). */
  function benefit(m, gaugeKey) {
    const g = GAUGE_BY_KEY[gaugeKey];
    if (g.stat === 'xp') return m.level < MAX_LEVEL ? 0.15 : 0;
    if (g.stat) return m[g.stat] < STAT_MAX && inZone(g.stat, m.serenity) ? 1 : 0;
    const zone = targetZone(m);
    if (!zone) return 0;
    const helps = (g.serenity < 0 && m.serenity > zone[1]) || (g.serenity > 0 && m.serenity < zone[0]);
    return helps ? 0.6 : 0;
  }

  /** All gauge combinations with fuel: singles and pairs, never both serenity gauges. */
  function gaugeCombos(fuel) {
    const keys = GAUGES.map((g) => g.key).filter((k) => fuel[k] > 0);
    const combos = [];
    for (let i = 0; i < keys.length; i++) {
      combos.push([keys[i]]);
      for (let j = i + 1; j < keys.length; j++) {
        if (GAUGE_BY_KEY[keys[i]].serenity && GAUGE_BY_KEY[keys[j]].serenity) continue;
        combos.push([keys[i], keys[j]]);
      }
    }
    return combos;
  }

  /**
   * Simulates a paddock with the given active gauges.
   * @param {string[]} combo active gauge keys (1 or 2)
   * @param {object[]} mounts mounts in the paddock
   * @param {object} fuel0 fuel per gauge key
   * @param {number} horizon seconds to simulate
   * @param {number} step seconds per step
   * @param {boolean} stopEarly end the run when it is time to reorganize
   * @returns {{mounts, fuel, events, elapsed, score}}
   */
  function simulate(combo, mounts, fuel0, horizon, step, stopEarly) {
    const ms = mounts.map((x) => ({ ...x }));
    const fuel = { ...fuel0 };
    const events = [];
    const seen = new Set();
    const zones = ms.map(targetZone);
    const startDistance = ms.map((x, i) => distanceToZone(x.serenity, zones[i]));
    const inZoneBefore = new Map();
    let t = 0;
    let gained = 0;

    const totalBenefit = () => {
      let sum = 0;
      for (const x of ms) for (const g of combo) sum += benefit(x, g);
      return sum;
    };
    const mark = (key, text) => {
      if (!seen.has(key)) {
        seen.add(key);
        events.push({ t, text });
      }
    };

    for (const x of ms) {
      for (const g of combo) {
        const stat = GAUGE_BY_KEY[g].stat;
        if (stat && stat !== 'xp') inZoneBefore.set(x.id + g, x[stat] < STAT_MAX && inZone(stat, x.serenity));
      }
    }

    const initialBenefit = totalBenefit();
    for (t = 0; t < horizon; t += step) {
      if (t > 0) {
        if (combo.every((g) => fuel[g] <= 0)) {
          mark('empty', 'Active gauges are out of fuel: refill');
          break;
        }
        const now = totalBenefit();
        if (now === 0) {
          mark('zero', 'No mount benefits from the active gauges anymore');
          break;
        }
        if (stopEarly && now <= initialBenefit * 0.5) {
          mark('half', 'Gauge output dropped by half: time to reorganize');
          break;
        }
        if (stopEarly) {
          const idle = combo.find((g) => GAUGE_BY_KEY[g].stat !== 'xp' && ms.every((x) => benefit(x, g) === 0));
          if (idle) {
            mark('idle' + idle, `Turn off ${GAUGE_BY_KEY[idle].name} (${GAUGE_BY_KEY[idle].game}): it no longer helps any mount`);
            break;
          }
        }
      }

      for (const g of combo) {
        const rate = tier(fuel[g]);
        if (!rate) continue;
        const gauge = GAUGE_BY_KEY[g];
        const anyBenefits = ms.some((x) =>
          gauge.serenity
            ? gauge.serenity < 0 ? x.serenity > SERENITY_MIN : x.serenity < SERENITY_MAX
            : benefit(x, g) > 0);
        if (!anyBenefits) continue; // a gauge does not drain when no mount can use it

        const amount = rate * step;
        fuel[g] = Math.max(0, fuel[g] - amount);
        if (fuel[g] === 0) mark('fuel' + g, `${gauge.name} (${gauge.game}) ran out of fuel`);

        for (const x of ms) {
          if (gauge.serenity) {
            x.serenity = clamp(x.serenity + gauge.serenity * amount, SERENITY_MIN, SERENITY_MAX);
          } else if (gauge.stat === 'xp') {
            x.xpGained = (x.xpGained || 0) + amount;
          } else if (benefit(x, g)) {
            const next = Math.min(STAT_MAX, x[gauge.stat] + amount);
            gained += next - x[gauge.stat];
            x[gauge.stat] = next;
            if (next >= STAT_MAX) mark(x.id + gauge.stat, `${x.id} maxed ${gauge.name}`);
          }
        }
      }

      for (let i = 0; i < ms.length; i++) {
        const x = ms[i];
        for (const g of combo) {
          const stat = GAUGE_BY_KEY[g].stat;
          if (!stat || stat === 'xp') continue;
          const was = inZoneBefore.get(x.id + g);
          const is = x[stat] < STAT_MAX && inZone(stat, x.serenity);
          if (was && !is && x[stat] < STAT_MAX) {
            mark(x.id + 'out' + g, `${x.id} left the ${GAUGE_BY_KEY[g].name} zone (serenity ${Math.round(x.serenity)})`);
          }
          inZoneBefore.set(x.id + g, is);
        }
        if (combo.some((g) => GAUGE_BY_KEY[g].serenity) && zones[i] &&
            distanceToZone(x.serenity, zones[i]) === 0 && startDistance[i] > 0) {
          mark(x.id + 'target', `${x.id} reached its target zone (${zones[i][0]} to ${zones[i][1]})`);
        }
      }

      if (ms.every(isFecund)) break;
    }

    let serenityProgress = 0;
    ms.forEach((x, i) => { serenityProgress += startDistance[i] - distanceToZone(x.serenity, zones[i]); });
    const xp = ms.reduce((a, x) => a + (x.xpGained || 0), 0);
    return { mounts: ms, fuel, events, elapsed: t, score: gained + 0.6 * serenityProgress + 0.05 * xp };
  }

  /** Picks the best gauge combo and the mounts to place for the current state. */
  function chooseBatch(state) {
    const candidates = state.mounts.filter(needsGauges);
    let best = null;
    for (const combo of gaugeCombos(state.fuel)) {
      const ranked = candidates
        .map((m) => ({ m, b: combo.reduce((a, g) => a + benefit(m, g), 0) }))
        .filter((o) => o.b > 0)
        .sort((a, b) => b.b - a.b);
      const selected = ranked.slice(0, state.slots).map((o) => o.m);
      if (!selected.length) continue;
      if (combo.some((g) => selected.every((m) => benefit(m, g) === 0))) continue;
      const sim = simulate(combo, selected, state.fuel, 6 * 3600, 120, false);
      if (!best || sim.score > best.sim.score + 1e-6) best = { combo, selected, sim };
    }
    return best;
  }

  /** Builds a multi-step schedule by re-choosing a batch after each simulated step. */
  function plan(state, maxSteps = 6) {
    const st = JSON.parse(JSON.stringify(state));
    const steps = [];
    let at = 0;
    for (let i = 0; i < maxSteps; i++) {
      const batch = chooseBatch(st);
      if (!batch) break;
      const run = simulate(batch.combo, batch.selected, st.fuel, 12 * 3600, 60, true);
      const duration = Math.max(run.elapsed, 600);
      steps.push({ at, duration, combo: batch.combo, mountIds: batch.selected.map((m) => m.id), events: run.events });
      const byId = Object.fromEntries(run.mounts.map((m) => [m.id, m]));
      st.mounts = st.mounts.map((m) => (byId[m.id] ? { ...byId[m.id], status: m.status } : m));
      st.fuel = run.fuel;
      at += duration;
    }
    return steps;
  }

  /** Minimum fuel per gauge to finish every fertile mount, assuming all share the paddock. */
  function fuelNeeded(state) {
    const ms = state.mounts.filter(needsGauges);
    const max = (arr) => Math.max(0, ...arr);
    return {
      endurance: max(ms.map((m) => STAT_MAX - m.endurance)),
      maturity: max(ms.map((m) => STAT_MAX - m.maturity)),
      love: max(ms.map((m) => STAT_MAX - m.love)),
      serenityDown: max([
        ...ms.map((m) => { const z = targetZone(m); return z && m.serenity > z[1] ? m.serenity - z[1] : 0; }),
        ...ms.filter((m) => m.endurance < STAT_MAX).map((m) => (m.serenity >= 0 ? m.serenity + 1 : 0)),
      ]),
      serenityUp: max([
        ...ms.map((m) => { const z = targetZone(m); return z && m.serenity < z[0] ? z[0] - m.serenity : 0; }),
        ...ms.filter((m) => m.love < STAT_MAX).map((m) => (m.serenity < 0 ? -m.serenity : 0)),
      ]),
      xp: 0,
    };
  }

  /** Chance of reaching the target generation: 30% split across targets + 0.15%/parent level + 20% Optimakina. */
  const targetChance = (sireLevel, damLevel, targetCount, optimakina) =>
    Math.min(1, 0.3 / Math.max(1, targetCount) + 0.0015 * (sireLevel + damLevel) + (optimakina ? 0.2 : 0));

  /** Expected value of a breeding, in kamas. */
  function breedingExpectedValue({ chance, targetPrice, fallbackPrice, parentsValue, fuelCost = 0, makinaCost = 0 }) {
    return chance * targetPrice + (1 - chance) * fallbackPrice - parentsValue - fuelCost - makinaCost;
  }

  /** Converts state saved by the earlier Portuguese version to the current schema. */
  function migrateState(raw) {
    if (!raw || !Array.isArray(raw.mounts)) throw new Error('Invalid state: missing mounts');
    const fuelKeys = { baffeur: 'serenityDown', caresseur: 'serenityUp', foudroyeur: 'endurance', abreuvoir: 'maturity', dragofesse: 'love', mangeoire: 'xp' };
    const statusMap = { 'fértil': 'fertile', 'estéril': 'sterile', 'senil': 'senile' };
    const fuel = {};
    for (const g of GAUGES) fuel[g.key] = 0;
    for (const [k, v] of Object.entries(raw.fuel || {})) fuel[fuelKeys[k] || k] = Number(v) || 0;
    const mounts = raw.mounts.map((m) => {
      const status = String(m.status ?? m.estado ?? 'fertile').toLowerCase();
      return {
        id: String(m.id ?? ''),
        name: String(m.name ?? m.nome ?? ''),
        species: m.species ?? (m.tipo === 'Dragoperu' ? 'Dragoturkey' : m.tipo) ?? 'Dragoturkey',
        sex: (m.sex ?? m.sexo) === 'M' ? 'M' : 'F',
        generation: Number(m.generation ?? m.ger) || 1,
        level: Number(m.level ?? m.nivel) || 1,
        endurance: clamp(Number(m.endurance ?? m.res) || 0, 0, STAT_MAX),
        maturity: clamp(Number(m.maturity ?? m.mat) || 0, 0, STAT_MAX),
        love: clamp(Number(m.love ?? m.amor) || 0, 0, STAT_MAX),
        serenity: clamp(Number(m.serenity ?? m.ser) || 0, SERENITY_MIN, SERENITY_MAX),
        status: statusMap[status] || (['fertile', 'sterile', 'senile'].includes(status) ? status : 'fertile'),
        notes: String(m.notes ?? m.obs ?? ''),
      };
    });
    return {
      updated: raw.updated || new Date().toISOString(),
      slots: Number(raw.slots) || 10,
      fuel,
      mounts,
      notes: String(raw.notes ?? ''),
    };
  }

  const Planner = {
    GAUGES, GAUGE_BY_KEY, STAT_MAX, SERENITY_MIN, SERENITY_MAX,
    tier, inZone, isFecund, needsGauges, targetZone, benefit, gaugeCombos,
    simulate, chooseBatch, plan, fuelNeeded, targetChance, breedingExpectedValue, migrateState,
  };

  if (typeof module === 'object' && module.exports) module.exports = Planner;
  else root.Planner = Planner;
})(typeof window !== 'undefined' ? window : globalThis);

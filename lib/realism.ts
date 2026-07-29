// The physical rules behind every sensor value: what the sun, the season, the
// weather, the occupants and the placement do to each phenomenon.
//
// `lib/solar.ts` answers "where is the sun and what is the climate here"; this
// file turns that into readings. Everything is a pure function of a
// `ShapeContext`, so the same URL always yields the same series.
//
// Two things shape every rule:
//   - location (`?lat=`/`?lon=`): latitude sets day length and the seasonal
//     climate, longitude sets where solar noon falls on the local clock.
//   - placement (`?placement=`): `outdoor` is exposed to the real sky and the
//     real seasonal air temperature; `indoor` sits behind glazing and a control
//     system, so it is damped, lagged and held near a setpoint. The same URL at
//     the same site reads -13 °C outdoors and 19 °C indoors in January.
//
// Numbers are deliberately simple engineering approximations, chosen so a
// January series looks like January and an occupied Tuesday looks occupied.
// They are not a substitute for a building energy model.

import { hashString, smoothNoise } from "@/lib/prng";
import { climate, cloudCover, cloudTransmittance, sunState } from "@/lib/solar";
import { localParts } from "@/lib/timezones";
import type {
  Placement,
  SensorParams,
  SensorRule,
  ShapeContext,
  SiteContext,
} from "@/lib/types";

const TAU = Math.PI * 2;
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The reference site: Ottawa, to a couple of decimal places. It is the site
 * `lib/solar.ts` is spot-checked against, and the default when a request names
 * no location.
 */
export const REFERENCE_SITE: { latitude: number; longitude: number } = {
  latitude: 45,
  longitude: -75,
};

/** Placement assumed when a request does not pick one. */
export const DEFAULT_PLACEMENT: Placement = "outdoor";

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Gaussian bump in [0, 1] centered at `center` hours with `width` hours of sigma. */
function bump(hour: number, center: number, width: number): number {
  const d = hour - center;
  return Math.exp(-(d * d) / (2 * width * width));
}

/** Smoothstep from 0 to 1 across a `width`-hour window centered on `center`. */
function ramp(hour: number, center: number, width: number): number {
  const t = clamp01((hour - (center - width / 2)) / width);
  return t * t * (3 - 2 * t);
}

/** Wrap an hour back into [0, 24) so a lagged schedule reads yesterday evening. */
function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Salt for the multi-day warm/cold spells layered on the seasonal mean. */
const AIRMASS_HASH = hashString("airmass");
/** Salt for the synoptic pressure series. */
const PRESSURE_HASH = hashString("pressure");

/** Amplitude of the multi-day temperature anomaly, in °C. */
const WEATHER_ANOMALY_C = 4;
/** Period of that anomaly: a warm spell lasts a few days. */
const ANOMALY_PERIOD_MS = 2.6 * DAY_MS;

/**
 * Everything the rules need about the site at one instant: the sun, the sky, the
 * season, and the outdoor air temperature they are mostly driven by.
 */
export function shapeContext(params: SensorParams, at: Date): ShapeContext {
  const { hour, dayOfYear, isWeekend } = localParts(at, params.offsetMinutes);
  const sun = sunState(
    dayOfYear,
    hour,
    params.latitude,
    params.longitude,
    params.offsetMinutes,
  );
  const cloud = cloudCover(params.seed, at);
  const site: SiteContext = {
    hour,
    dayOfYear,
    isWeekend,
    latitude: params.latitude,
    longitude: params.longitude,
    offsetMinutes: params.offsetMinutes,
    placement: params.placement,
    at,
    seed: params.seed,
    sun,
    cloud,
    climate: climate(dayOfYear, params.latitude, cloud),
  };
  return { ...site, outdoorC: outdoorAirTemp(site) };
}

// ---------------------------------------------------------------------------
// Site physics
// ---------------------------------------------------------------------------

/** Hours the air temperature peak lags solar noon while the ground keeps heating. */
const TEMP_LAG_HOURS = 2.5;

/**
 * Outdoor dry-bulb air temperature in °C: the day's climatological mean, plus a
 * multi-day warm or cold spell, plus a diurnal swing that peaks a couple of
 * hours after solar noon.
 *
 * The real curve is asymmetric (a fast morning rise, a slow overnight decay); a
 * single cosine is a degree or two off at dawn and dusk but stays continuous
 * across midnight, which matters more here.
 */
export function outdoorAirTemp(ctx: SiteContext): number {
  const { meanC, diurnalRangeC } = ctx.climate;
  const peakHour = ctx.sun.solarNoonHour + TEMP_LAG_HOURS;
  const diurnal = 0.5 + 0.5 * Math.cos((TAU * (ctx.hour - peakHour)) / 24);
  const anomaly =
    WEATHER_ANOMALY_C *
    smoothNoise(ctx.at.getTime() / ANOMALY_PERIOD_MS, ctx.seed, AIRMASS_HASH);
  return meanC + anomaly + diurnalRangeC * (diurnal - 0.5);
}

/** Heating and cooling setpoints in °C; the season decides which one is in force. */
const HEATING_SETPOINT_C = 20.5;
const COOLING_SETPOINT_C = 24;
/** Fraction of the indoor/outdoor gap an imperfectly controlled room gives up. */
const ENVELOPE_COUPLING = 0.08;
/** Peak temperature lift from sun through glazing, in °C. */
const SOLAR_GAIN_C = 2;
/** Temperature lift at full occupancy from people, lights and equipment, in °C. */
const OCCUPANT_GAIN_C = 0.9;

/** The setpoint being held: heating in winter, cooling in summer. */
export function setpointC(ctx: SiteContext): number {
  return (
    HEATING_SETPOINT_C +
    (COOLING_SETPOINT_C - HEATING_SETPOINT_C) * ctx.climate.summerness
  );
}

/**
 * Indoor air temperature in °C: the setpoint, dragged a little toward outdoors
 * by the envelope, lifted by sun through the glazing and by the people in the
 * room. Damped and lagged relative to outdoors, which is the whole point of a
 * building.
 */
export function indoorAirTemp(ctx: ShapeContext): number {
  const setpoint = setpointC(ctx);
  return (
    setpoint +
    ENVELOPE_COUPLING * (ctx.outdoorC - setpoint) +
    SOLAR_GAIN_C * ctx.sun.sinElevation * cloudTransmittance(ctx.cloud) +
    OCCUPANT_GAIN_C * occupancy(ctx)
  );
}

/** Air temperature this sensor actually sees, given where it sits. */
export function airTemp(ctx: ShapeContext): number {
  return ctx.placement === "indoor" ? indoorAirTemp(ctx) : ctx.outdoorC;
}

/** Saturation vapour pressure over water in hPa (Magnus-Tetens). */
function saturationVapourPressure(tempC: number): number {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

/**
 * Relative humidity in % of air at `tempC` whose dew point is `dewPointC`.
 * Warming air without adding moisture lowers RH, which is why a heated room in
 * January is so dry.
 */
export function relativeHumidity(tempC: number, dewPointC: number): number {
  const rh =
    (100 * saturationVapourPressure(dewPointC)) /
    saturationVapourPressure(tempC);
  return clamp(rh, 1, 100);
}

/**
 * Dew-point lift in °C from indoor moisture sources (people, cooking, plants).
 * Without it a heated room in a cold climate would read single-digit RH.
 */
const INTERNAL_MOISTURE_C = 7;

/**
 * Dew point a cooling coil leaves the air at, in °C. A coil is a dehumidifier,
 * which is why a conditioned room in a humid August is not at 90% RH.
 */
const COIL_DEW_POINT_C = 13;

/** Luminous efficacy of daylight, in lumens per watt of global irradiance. */
const LUMINOUS_EFFICACY = 110;
/** Sky glow through civil twilight, in lux. */
const TWILIGHT_LUX = 350;
/** Full-moon ground illuminance, in lux — the night floor. */
const MOONLIGHT_LUX = 0.3;

/** Global horizontal irradiance reaching the ground, in W/m². */
export function groundIrradiance(ctx: SiteContext): number {
  return ctx.sun.clearSkyGhi * cloudTransmittance(ctx.cloud);
}

/** Outdoor illuminance in lux: daylight, then twilight, then moonlight. */
export function outdoorIlluminance(ctx: SiteContext): number {
  return (
    groundIrradiance(ctx) * LUMINOUS_EFFICACY +
    TWILIGHT_LUX * ctx.sun.twilight +
    MOONLIGHT_LUX
  );
}

/** Daylight factor a few metres inside a glazed facade: ~2% of outdoor lux. */
const DAYLIGHT_FACTOR = 0.018;
/** Illuminance electric lighting maintains over a working plane, in lux. */
const ELECTRIC_LIGHT_LUX = 420;
/** Daylight level below which the lights come on, in lux. */
const LIGHTING_THRESHOLD_LUX = 300;

/** How hard the electric lighting is working, in [0, 1]. */
export function electricLighting(ctx: ShapeContext): number {
  const daylit = outdoorIlluminance(ctx) * DAYLIGHT_FACTOR;
  const shortfall = clamp01(
    (LIGHTING_THRESHOLD_LUX - daylit) / LIGHTING_THRESHOLD_LUX,
  );
  return shortfall * occupancy(ctx);
}

/** Indoor illuminance in lux: daylight through the glazing plus the lights. */
export function indoorIlluminance(ctx: ShapeContext): number {
  return (
    outdoorIlluminance(ctx) * DAYLIGHT_FACTOR +
    ELECTRIC_LIGHT_LUX * electricLighting(ctx)
  );
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** Weekday arrival and departure hours; both are ramps, not steps. */
const OPEN_HOUR = 7.5;
const CLOSE_HOUR = 18;

/** Fraction of design occupancy at a local hour. */
function occupancyAt(hour: number, isWeekend: boolean): number {
  if (isWeekend) {
    // A trickle of weekend activity, starting late and ending early.
    return (
      0.18 * clamp01(Math.min(ramp(hour, 10, 3), 1 - ramp(hour, 17, 3)))
    );
  }
  const present = clamp01(
    Math.min(ramp(hour, OPEN_HOUR, 1.5), 1 - ramp(hour, CLOSE_HOUR, 2)),
  );
  // People leave for lunch and a few stay late.
  return present * (1 - 0.25 * bump(hour, 12.5, 0.8));
}

/** Fraction of design occupancy in the room right now. */
export function occupancy(ctx: SiteContext): number {
  return occupancyAt(ctx.hour, ctx.isWeekend);
}

/** Occupancy `lagHours` ago — for phenomena that respond slowly, like CO2. */
function laggedOccupancy(ctx: SiteContext, lagHours: number): number {
  return occupancyAt(wrapHour(ctx.hour - lagHours), ctx.isWeekend);
}

/**
 * Street activity in [0, 1]: commute peaks on a weekday, a flat afternoon on a
 * weekend. Drives outdoor movement and noise.
 */
export function traffic(ctx: SiteContext): number {
  if (ctx.isWeekend) return clamp01(0.12 + 0.5 * bump(ctx.hour, 14, 4));
  return clamp01(
    0.1 +
      0.55 * bump(ctx.hour, 8, 1.1) +
      0.65 * bump(ctx.hour, 17.2, 1.4) +
      0.3 * bump(ctx.hour, 13, 3.5),
  );
}

/** Outdoor-air temperature span, in °C, that saturates the HVAC plant. */
const HVAC_DESIGN_SPAN_C = 22;

/**
 * How hard heating or cooling is working, in [0, 1]: driven by how far outdoors
 * is from the setpoint, and turned down when the building is empty.
 */
export function hvacDemand(ctx: ShapeContext): number {
  const gap = Math.abs(ctx.outdoorC - setpointC(ctx));
  const load = clamp01(gap / HVAC_DESIGN_SPAN_C);
  return load * (0.35 + 0.65 * occupancy(ctx));
}

/** How much of the night the dusk-to-dawn exterior lighting is on, in [0, 1]. */
function darkness(ctx: SiteContext): number {
  return 1 - ctx.sun.twilight;
}

/**
 * Local hours across which the exterior lighting's late-night trim comes in and
 * goes back out. The trim has to be over well before dusk, or restoring full
 * output lands just before dawn and puts a spike on the end of the night, so it
 * releases across the afternoon — where, at any latitude that has a dawn, the
 * lights are already off and it cannot be seen.
 */
const DIM_START_HOUR = 1;
const DIM_RELEASE_HOUR = 15;
/** Fraction of full output the lighting is trimmed back to through the small hours. */
const LATE_NIGHT_DIM = 0.55;

/**
 * Exterior lighting output in [0, 1]: photocell dusk-to-dawn, trimmed back
 * through the small hours the way a real site controller does once the last car
 * has gone. Multiplied by `darkness`, so it is 0 whenever the sky is lit.
 */
export function exteriorLighting(ctx: SiteContext): number {
  const trim = clamp01(
    Math.min(ramp(ctx.hour, DIM_START_HOUR, 1), 1 - ramp(ctx.hour, DIM_RELEASE_HOUR, 5)),
  );
  return darkness(ctx) * (1 - (1 - LATE_NIGHT_DIM) * trim);
}

/** Outdoor air temperature, relative to the setpoint, at which heat rejection starts. */
const HEAT_REJECTION_LEAD_C = 6;
/** Further warming, in °C, that saturates the heat-rejection plant. */
const HEAT_REJECTION_SPAN_C = 14;

/**
 * How hard outdoor heat-rejection plant (condensers, dry coolers, a cooling
 * tower) is working, in [0, 1]. It starts below the setpoint — solar gain and
 * internal loads mean a building is rejecting heat well before the air is warmer
 * than the room — and saturates on a hot afternoon.
 */
export function heatRejection(ctx: ShapeContext): number {
  const onsetC = setpointC(ctx) - HEAT_REJECTION_LEAD_C;
  return clamp01((ctx.outdoorC - onsetC) / HEAT_REJECTION_SPAN_C);
}

/** Air temperature freeze protection starts at, and the span that saturates it. */
const FREEZE_ONSET_C = 2;
const FREEZE_SPAN_C = 8;

/** How hard freeze protection (trace heating, pipe and gutter heaters) is working. */
export function freezeProtection(ctx: ShapeContext): number {
  return clamp01((FREEZE_ONSET_C - ctx.outdoorC) / FREEZE_SPAN_C);
}

/**
 * Warmest and coldest the outdoor air gets on this day, including room for a
 * warm or cold spell. Used to size ranges that depend on how hard the weather
 * will drive the plant today, without evaluating every hour of the day.
 */
function dailyExtremes(ctx: ShapeContext): { minC: number; maxC: number } {
  const { meanC, diurnalRangeC } = ctx.climate;
  const margin = diurnalRangeC / 2 + WEATHER_ANOMALY_C;
  return { minC: meanC - margin, maxC: meanC + margin };
}

/** Duty cycle of the plant this `state` sensor is attached to, in [0, 1]. */
function dutyCycle(ctx: ShapeContext): number {
  return ctx.placement === "indoor"
    ? Math.max(occupancy(ctx), hvacDemand(ctx))
    : Math.max(darkness(ctx), freezeProtection(ctx), heatRejection(ctx));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Pick one of two values by placement — the shape most rules take. */
function byPlacement<T>(ctx: SiteContext, indoor: T, outdoor: T): T {
  return ctx.placement === "indoor" ? indoor : outdoor;
}

/**
 * An honest outdoor thermometer reports the season: the effective range follows
 * the day's climatology, so January reads well below zero and no caller has to
 * remember to pass `min`/`max`. Indoors the range is a band around the setpoint.
 */
export const temperatureRule: SensorRule = {
  value: airTemp,
  range: (ctx) => {
    if (ctx.placement === "indoor") {
      const setpoint = setpointC(ctx);
      return { min: round1(setpoint - 4), max: round1(setpoint + 4.5) };
    }
    const { meanC, diurnalRangeC } = ctx.climate;
    // Room for the diurnal swing, a warm or cold spell, and seeded noise.
    const margin = diurnalRangeC / 2 + WEATHER_ANOMALY_C + 2;
    return { min: round1(meanC - margin), max: round1(meanC + margin) };
  },
};

/**
 * Humidity follows the dew point, which barely moves through the day: outdoors
 * RH rises to saturation overnight as the air cools, and indoors the same air
 * warmed to room temperature reads far drier — the January dryness everyone
 * complains about.
 */
export const humidityRule: SensorRule = {
  value: (ctx) => {
    if (ctx.placement === "indoor") {
      // Moisture indoors is whatever came in from outside plus what the
      // occupants add — unless the cooling coil is running, which caps it. The
      // `min` picks whichever is in force: the lift in winter, the coil in summer.
      const occupied = ctx.climate.dewPointC + INTERNAL_MOISTURE_C;
      const conditioned = COIL_DEW_POINT_C + 3 * occupancy(ctx);
      return relativeHumidity(indoorAirTemp(ctx), Math.min(occupied, conditioned));
    }
    return relativeHumidity(ctx.outdoorC, ctx.climate.dewPointC);
  },
  range: (ctx) => byPlacement(ctx, { min: 8, max: 75 }, { min: 20, max: 100 }),
};

/**
 * Light is astronomy, so the peak timing is not up for seeded negotiation.
 * Outdoors it runs from moonlight to ~90,000 lux; indoors a 2% daylight factor
 * plus maintained electric lighting keeps it inside a couple of thousand lux.
 */
export const lightRule: SensorRule = {
  solarLocked: true,
  restsAtZero: true,
  value: (ctx) =>
    ctx.placement === "indoor" ? indoorIlluminance(ctx) : outdoorIlluminance(ctx),
  range: (ctx) => byPlacement(ctx, { min: 0, max: 2200 }, { min: 0, max: 100000 }),
};

/** Glazing transmittance, and the fraction of it landing on an interior surface. */
const GLAZING_TRANSMITTANCE = 0.55;
const INTERIOR_SURFACE_FRACTION = 0.3;

/** Irradiance is the same astronomy as light, measured in W/m² instead of lux. */
export const irradianceRule: SensorRule = {
  solarLocked: true,
  restsAtZero: true,
  value: (ctx) =>
    groundIrradiance(ctx) *
    (ctx.placement === "indoor"
      ? GLAZING_TRANSMITTANCE * INTERIOR_SURFACE_FRACTION
      : 1),
  range: (ctx) => byPlacement(ctx, { min: 0, max: 220 }, { min: 0, max: 1100 }),
};

/** Mean sea-level pressure in hPa, and the swing between highs and lows. */
const MSL_PRESSURE_HPA = 1013.25;
const SYNOPTIC_SWING_HPA = 14;
/** Period of one weather system passing over, matching lib/solar.ts. */
const SYNOPTIC_PERIOD_MS = 3.2 * DAY_MS;
/** Pressure a pressurized building sits above ambient, in hPa. */
const BUILDING_PRESSURIZATION_HPA = 0.15;

/**
 * Pressure is a property of the air mass, so it is the one sensor placement
 * barely touches: a pressurized building reads a fraction of a hectopascal
 * above ambient. Lows arrive with the cloud.
 */
export const pressureRule: SensorRule = {
  value: (ctx) =>
    MSL_PRESSURE_HPA +
    SYNOPTIC_SWING_HPA *
      smoothNoise(ctx.at.getTime() / SYNOPTIC_PERIOD_MS, ctx.seed, PRESSURE_HASH) -
    8 * (ctx.cloud - 0.45) +
    (ctx.placement === "indoor" ? BUILDING_PRESSURIZATION_HPA : 0),
  range: () => ({ min: 980, max: 1040 }),
};

/** Outdoor CO2 background in ppm. */
const OUTDOOR_CO2_PPM = 421;
/** Indoor build-up at full occupancy before ventilation catches up, in ppm. */
const CO2_OCCUPIED_RISE_PPM = 1150;
/** How much demand-controlled ventilation flattens the peak. */
const CO2_VENTILATION_RELIEF = 0.6;
/** Hours CO2 lags the people who exhaled it. */
const CO2_LAG_HOURS = 0.6;

/**
 * CO2 outdoors is background plus a little traffic, trapped near the ground by
 * the nocturnal inversion. Indoors it is a crowding signal: it climbs while a
 * room fills and clears to near-outdoor overnight.
 */
export const airQualityRule: SensorRule = {
  value: (ctx) => {
    const outdoor =
      OUTDOOR_CO2_PPM + 55 * traffic(ctx) * (1 - 0.5 * ctx.sun.sinElevation);
    if (ctx.placement === "outdoor") return outdoor;
    const occ = laggedOccupancy(ctx, CO2_LAG_HOURS);
    return outdoor + (CO2_OCCUPIED_RISE_PPM * occ) / (1 + CO2_VENTILATION_RELIEF * occ);
  },
  range: (ctx) => byPlacement(ctx, { min: 400, max: 1800 }, { min: 400, max: 520 }),
};

/** Indoor electrical loads in W at full demand. */
const BASE_LOAD_W = 220;
const PLUG_LOAD_W = 700;
const LIGHTING_LOAD_W = 300;
const HVAC_LOAD_W = 1100;

/** Exterior loads in W, each at full output. */
const EXTERIOR_STANDING_W = 90; // controls, comms, signage: never off
const EXTERIOR_LIGHTING_W = 480; // dusk-to-dawn lighting
const EXTERIOR_ACTIVITY_W = 420; // pumps, fans, doors, vehicle charging
const HEAT_REJECTION_W = 900; // condensers and dry coolers
const FREEZE_PROTECTION_W = 900; // trace heating and gutter heaters

/**
 * Indoor demand is occupancy plus weather: plug load and lighting follow the
 * people, HVAC follows how far outdoors is from the setpoint.
 *
 * An exterior meter is the same site seen from the outside: a standing load that
 * never stops, dusk-to-dawn lighting that dims through the small hours, plant
 * that follows site activity, and whichever of heat rejection or freeze
 * protection the weather is calling for. So it peaks on a hot afternoon in July
 * and overnight in January, and it is never flat — the old version was a
 * two-state square wave that read exactly 120 W for the whole of a summer day.
 */
export const energyRule: SensorRule = {
  // Outdoors the shape is a photocell's, and a photocell does not switch an hour
  // late because of a seed. Indoors it follows a schedule, which may shift.
  solarLocked: (placement) => placement === "outdoor",
  restsAtZero: true,
  value: (ctx) => {
    if (ctx.placement === "outdoor") {
      return (
        EXTERIOR_STANDING_W +
        EXTERIOR_LIGHTING_W * exteriorLighting(ctx) +
        EXTERIOR_ACTIVITY_W * traffic(ctx) +
        HEAT_REJECTION_W * heatRejection(ctx) +
        FREEZE_PROTECTION_W * freezeProtection(ctx)
      );
    }
    return (
      BASE_LOAD_W +
      PLUG_LOAD_W * occupancy(ctx) +
      LIGHTING_LOAD_W * electricLighting(ctx) +
      HVAC_LOAD_W * hvacDemand(ctx)
    );
  },
  // A meter reads from zero up, and the top of the band is what today's weather
  // can actually call for. Sizing the outdoor band on the January peak would
  // leave a July series bunched into the bottom of its own range, where the
  // noise term dwarfs the signal.
  range: (ctx) => {
    if (ctx.placement === "indoor") {
      return { min: 0, max: BASE_LOAD_W + PLUG_LOAD_W + LIGHTING_LOAD_W + HVAC_LOAD_W };
    }
    const { minC, maxC } = dailyExtremes(ctx);
    const onsetC = setpointC(ctx) - HEAT_REJECTION_LEAD_C;
    const cooling = HEAT_REJECTION_W * clamp01((maxC - onsetC) / HEAT_REJECTION_SPAN_C);
    const freezing = FREEZE_PROTECTION_W * clamp01((FREEZE_ONSET_C - minC) / FREEZE_SPAN_C);
    // Everything but heating-vs-cooling can coincide: in January the evening
    // commute peak lands after dusk, with the lighting and the trace heating
    // already on. Only one of the two weather loads can run at a time.
    return {
      min: 0,
      max: Math.round(
        EXTERIOR_STANDING_W +
          EXTERIOR_LIGHTING_W +
          EXTERIOR_ACTIVITY_W +
          Math.max(cooling, freezing),
      ),
    };
  },
};

/** Occupancy detection indoors, pedestrians and vehicles outdoors. */
export const movementRule: SensorRule = {
  prob: (ctx) =>
    ctx.placement === "indoor"
      ? clamp01(0.02 + 0.9 * occupancy(ctx))
      : clamp01(0.02 + 0.75 * traffic(ctx)),
};

/**
 * Plant state follows its duty cycle: the HVAC and the people indoors, the
 * lighting circuit and the freeze protection outdoors. Errors stay rare, and
 * cluster where temperature extremes strain the equipment.
 */
export const stateRule: SensorRule = {
  weights: (ctx) => {
    const duty = dutyCycle(ctx);
    const stress = clamp01((Math.abs(ctx.outdoorC - 15) - 18) / 20);
    return [
      0.05 + 0.9 * duty, // on
      0.6 * Math.pow(1 - duty, 2), // off
      0.12 + 0.45 * (1 - duty), // idle
      0.008 + 0.05 * stress, // error
    ];
  },
};

/** Domestic draw in L/min at full occupancy. */
const DOMESTIC_FLOW_LPM = 3.2;
/** Peak flow of an irrigation cycle, in L/min. */
const IRRIGATION_FLOW_LPM = 7.5;
/** Local hours the irrigation controller runs, and the width of a cycle. */
const IRRIGATION_MORNING_HOUR = 4.6;
const IRRIGATION_EVENING_HOUR = 20.4;
const IRRIGATION_WIDTH_H = 1.1;
/** Share of the morning volume the shorter evening cycle puts down. */
const EVENING_IRRIGATION_SHARE = 0.7;
/** Cooling-tower and evaporative make-up at full heat rejection, in L/min. */
const MAKEUP_FLOW_LPM = 2.4;
/** Hose, washdown and misc. site draw at full activity, in L/min. */
const HOSE_FLOW_LPM = 0.9;

/**
 * Indoors this is domestic water: nothing overnight, morning and end-of-day
 * peaks around a working day.
 *
 * Outdoors it is the site's water: irrigation cycles before dawn and after
 * dusk in the growing season, evaporative make-up while the plant is rejecting
 * heat, and hose and washdown draw through an active day. It goes to a hard zero
 * once the line would freeze, which is real — a drained irrigation main in
 * January reads exactly nothing. The previous version had only the pre-dawn
 * cycle, so it read a solid 0.00 for twenty hours out of twenty-four.
 */
export const flowRule: SensorRule = {
  restsAtZero: true,
  value: (ctx) => {
    if (ctx.placement === "outdoor") {
      // Below +1 °C the line is drained; above +5 °C it runs normally.
      const unfrozen = clamp01((ctx.outdoorC - 1) / 4);
      const season = clamp01((ctx.climate.summerness - 0.35) / 0.4);
      const cycles =
        bump(ctx.hour, IRRIGATION_MORNING_HOUR, IRRIGATION_WIDTH_H) +
        EVENING_IRRIGATION_SHARE *
          bump(ctx.hour, IRRIGATION_EVENING_HOUR, IRRIGATION_WIDTH_H);
      return (
        unfrozen *
        (IRRIGATION_FLOW_LPM * season * cycles +
          MAKEUP_FLOW_LPM * heatRejection(ctx) +
          HOSE_FLOW_LPM * traffic(ctx))
      );
    }
    const peaks = 0.7 + 0.6 * bump(ctx.hour, 8.5, 1.2) + 0.5 * bump(ctx.hour, 17.5, 1.5);
    return DOMESTIC_FLOW_LPM * occupancy(ctx) * peaks;
  },
  range: () => ({ min: 0, max: 12 }),
};

/** Sound pressure floors in dB, and the lift from a fully active site. */
const INDOOR_QUIET_DB = 31;
const INDOOR_OCCUPIED_LIFT_DB = 24;
const OUTDOOR_QUIET_DB = 36;
const OUTDOOR_TRAFFIC_LIFT_DB = 24;

/** An empty room is ~31 dB; a busy street at rush hour is ~60 dB. */
export const noiseRule: SensorRule = {
  value: (ctx) =>
    ctx.placement === "indoor"
      ? INDOOR_QUIET_DB + INDOOR_OCCUPIED_LIFT_DB * occupancy(ctx)
      : OUTDOOR_QUIET_DB + OUTDOOR_TRAFFIC_LIFT_DB * traffic(ctx),
  range: (ctx) => byPlacement(ctx, { min: 28, max: 75 }, { min: 32, max: 85 }),
};

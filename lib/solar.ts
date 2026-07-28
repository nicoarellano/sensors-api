// Solar geometry, sky conditions and seasonal climate — the physical drivers
// behind every sensor curve in lib/realism.ts.
//
// Everything here is a pure function of (day-of-year, hour, latitude,
// longitude, UTC offset) plus, for weather, a seed. No clocks, no I/O, so the
// same URL always yields the same series.
//
// The solar position uses the NOAA low-precision equations (Solar Calculation
// Details, https://gml.noaa.gov/grad/solcalc/calcdetails.html), which are good
// to roughly a minute on sunrise/sunset and a few tenths of a degree on
// elevation — far tighter than synthetic sensor data needs. Spot-checked
// against Ottawa (45.42 N, 75.70 W) on 2026-07-28:
//
//   solar noon 13:09 EDT (actual 13:11), sunset 20:38 (20:37),
//   peak elevation 64.0 deg (63.9), clear-sky GHI at noon 926 W/m2 (~920).

import { hashString, smoothNoise } from "@/lib/prng";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

/** Mean days in a year, averaged over the leap cycle. */
const YEAR_DAYS = 365.25;

/**
 * Solar zenith angle of sunrise/sunset: 90 degrees plus 50 arcminutes for
 * atmospheric refraction and the sun's apparent radius.
 */
const SUNRISE_ZENITH = 90.833;

/**
 * Peak clear-sky global horizontal irradiance coefficient and atmospheric
 * extinction term (Meinel & Meinel): GHI = 1098 * sin(a) * exp(-0.057/sin(a)).
 * Gives ~1037 W/m2 at the zenith and ~926 at 64 degrees, both realistic.
 */
const CLEAR_SKY_PEAK = 1098;
const CLEAR_SKY_EXTINCTION = 0.057;

/** Elevation (degrees) at which civil twilight ends and true night begins. */
const CIVIL_TWILIGHT_DEG = -6;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** Where the sun is, and what that implies for light, at one instant. */
export interface SunState {
  /** Solar declination in degrees (+23.44 at the June solstice). */
  declinationDeg: number;
  /** Equation of time in minutes (apparent minus mean solar time). */
  equationOfTimeMin: number;
  /** Local clock hour of solar noon (may fall outside [0, 24) at zone edges). */
  solarNoonHour: number;
  /** Solar elevation above the horizon in degrees; negative at night. */
  elevationDeg: number;
  /** sin(elevation), floored at 0 — the geometric factor for horizontal flux. */
  sinElevation: number;
  /**
   * Local clock hour of sunrise/sunset for this day, or null under polar day or
   * polar night. Not wrapped into [0, 24): the values stay on the same
   * arithmetic axis as `hour` so "hours since sunrise" is a plain subtraction.
   */
  sunriseHour: number | null;
  sunsetHour: number | null;
  /** Hours the sun is above the horizon: 0 in polar night, 24 in polar day. */
  dayLengthHours: number;
  /** True while the sun is above the horizon. */
  isDaylight: boolean;
  /**
   * How much of the sky is still lit, in [0, 1]: 1 whenever the sun is up,
   * falling to 0 at the end of civil twilight. Keeps dusk from being a cliff.
   */
  twilight: number;
  /** Clear-sky global horizontal irradiance in W/m2; 0 below the horizon. */
  clearSkyGhi: number;
}

/**
 * Fractional year in radians — the angle NOAA's declination and
 * equation-of-time series are expanded in.
 */
function fractionalYear(dayOfYear: number, hour: number): number {
  return (TAU * (dayOfYear - 1 + (hour - 12) / 24)) / 365;
}

/** Solar declination in radians (NOAA series). */
function declinationRad(g: number): number {
  return (
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  );
}

/** Equation of time in minutes (NOAA series). */
function equationOfTime(g: number): number {
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

/**
 * Full solar state at a local instant. `longitude` is degrees east of
 * Greenwich (negative in the Americas) and `offsetMinutes` is the zone's fixed
 * offset from UTC, so the two together place local clock time correctly against
 * true solar time.
 */
export function sunState(
  dayOfYear: number,
  hour: number,
  latitude: number,
  longitude: number,
  offsetMinutes: number,
): SunState {
  const g = fractionalYear(dayOfYear, hour);
  const decl = declinationRad(g);
  const eqTime = equationOfTime(g);

  // Minutes to add to local clock time to reach true solar time.
  const timeOffsetMin = eqTime + 4 * longitude - offsetMinutes;
  const solarNoonHour = (720 - timeOffsetMin) / 60;
  const hourAngle = ((hour * 60 + timeOffsetMin) / 4 - 180) * DEG;

  const latRad = latitude * DEG;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinDecl = Math.sin(decl);
  const cosDecl = Math.cos(decl);

  // cos(zenith) is exactly sin(elevation).
  const sinElev = clamp(
    sinLat * sinDecl + cosLat * cosDecl * Math.cos(hourAngle),
    -1,
    1,
  );
  const elevationDeg = Math.asin(sinElev) / DEG;

  // Hour angle at sunrise. |cos| > 1 means the sun never crosses the horizon:
  // above +1 it never rises (polar night), below -1 it never sets (polar day).
  const cosHourAngle0 =
    (Math.cos(SUNRISE_ZENITH * DEG) - sinLat * sinDecl) / (cosLat * cosDecl);
  let sunriseHour: number | null = null;
  let sunsetHour: number | null = null;
  let dayLengthHours: number;
  if (cosHourAngle0 >= 1 || !Number.isFinite(cosHourAngle0)) {
    dayLengthHours = 0; // polar night
  } else if (cosHourAngle0 <= -1) {
    dayLengthHours = 24; // polar day
  } else {
    const halfDay = Math.acos(cosHourAngle0) / DEG / 15;
    dayLengthHours = 2 * halfDay;
    sunriseHour = solarNoonHour - halfDay;
    sunsetHour = solarNoonHour + halfDay;
  }

  const flux = Math.max(0, sinElev);
  const clearSkyGhi =
    flux > 0 ? CLEAR_SKY_PEAK * flux * Math.exp(-CLEAR_SKY_EXTINCTION / flux) : 0;

  return {
    declinationDeg: decl / DEG,
    equationOfTimeMin: eqTime,
    solarNoonHour,
    elevationDeg,
    sinElevation: flux,
    sunriseHour,
    sunsetHour,
    dayLengthHours,
    isDaylight: elevationDeg > 0,
    twilight: clamp01((elevationDeg - CIVIL_TWILIGHT_DEG) / -CIVIL_TWILIGHT_DEG),
    clearSkyGhi,
  };
}

/**
 * Weather is a property of the site and the day, not of any one sensor, so the
 * cloud series is salted without the sensor type. That makes light, irradiance
 * and temperature agree about the weather: an overcast afternoon dims the light
 * sensor and flattens the temperature curve at the same time.
 */
const WEATHER_HASH = hashString("weather");
const SYNOPTIC_SALT = 0xc10d;
const BROKEN_SALT = 0xc10e;

/** Period of the slow, frontal-scale component: a few days per weather system. */
const SYNOPTIC_PERIOD_MS = 3.2 * DAY_MS;
/** Period of the fast component: broken cloud drifting across the sky. */
const BROKEN_PERIOD_MS = 4 * HOUR_MS;

/**
 * Fractional cloud cover in [0, 1] — 0 is a cloudless sky, 1 is full overcast.
 * Two smooth octaves: a multi-day synoptic term that gives whole clear or
 * overcast days, plus a few-hour term for broken cloud within a day.
 */
export function cloudCover(seed: number, at: Date): number {
  const t = at.getTime();
  const synoptic = smoothNoise(
    t / SYNOPTIC_PERIOD_MS,
    seed,
    WEATHER_HASH,
    SYNOPTIC_SALT,
  );
  const broken = smoothNoise(t / BROKEN_PERIOD_MS, seed, WEATHER_HASH, BROKEN_SALT);
  return clamp01(0.45 + 0.42 * synoptic + 0.18 * broken);
}

/**
 * Fraction of clear-sky irradiance that reaches the ground under this much
 * cloud (Kasten & Czeplak): full overcast still passes ~25% as diffuse light,
 * which is why an overcast noon reads thousands of lux rather than zero.
 */
export function cloudTransmittance(cloud: number): number {
  return 1 - 0.75 * Math.pow(clamp01(cloud), 3);
}

/** Seasonal climate at a latitude: what "a typical day" looks like. */
export interface Climate {
  /** Daily mean outdoor air temperature in °C. */
  meanC: number;
  /** Peak-to-trough diurnal temperature range in °C. */
  diurnalRangeC: number;
  /** Dew point in °C — near-constant through the day, which sets humidity. */
  dewPointC: number;
  /** 0 at midwinter, 1 at midsummer. Drives cooling vs heating season. */
  summerness: number;
}

/**
 * A deliberately simple two-parameter climatology: annual mean temperature
 * falls with latitude and the seasonal swing grows with it. At 45 N this gives
 * an 8.8 °C annual mean and a ±15 °C seasonal swing, against Ottawa's actual
 * 6.8 °C and ±15 °C. Good enough to make July look like July and January look
 * like January; it is not a substitute for real climate normals.
 */
const ANNUAL_MEAN_AT_EQUATOR = 27;
const ANNUAL_MEAN_LAPSE_PER_DEG = 0.4;
const SEASONAL_AMPLITUDE_PER_DEG = 0.33;
/** Day of year of the warmest mean in the northern hemisphere (late July). */
const NORTHERN_PEAK_DAY = 200;

export function climate(
  dayOfYear: number,
  latitude: number,
  cloud: number,
): Climate {
  const absLat = Math.min(Math.abs(latitude), 90);
  const annualMean = ANNUAL_MEAN_AT_EQUATOR - ANNUAL_MEAN_LAPSE_PER_DEG * absLat;
  const seasonalAmplitude = SEASONAL_AMPLITUDE_PER_DEG * absLat;

  // The southern hemisphere's seasons are half a year out of phase.
  const peakDay =
    latitude >= 0 ? NORTHERN_PEAK_DAY : NORTHERN_PEAK_DAY + YEAR_DAYS / 2;
  const seasonal = Math.cos((TAU * (dayOfYear - peakDay)) / YEAR_DAYS);
  const summerness = clamp01(0.5 + 0.5 * seasonal);
  const meanC = annualMean + seasonalAmplitude * seasonal;

  // Clear skies radiate freely by night and heat hard by day, so the diurnal
  // range is widest under a cloudless summer sky and narrowest under overcast.
  const diurnalRangeC = (8 + 4 * summerness) * (1 - 0.35 * clamp01(cloud));

  // In a humid continental climate the dew point sits just below the daily
  // minimum: cloudy air is closer to saturation, clear air a little drier.
  const dailyMinC = meanC - diurnalRangeC / 2;
  const dewPointC = dailyMinC - 1 + 3 * clamp01(cloud);

  return { meanC, diurnalRangeC, dewPointC, summerness };
}

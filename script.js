// ====== CONFIG ======
// The API key is NOT stored in this file. It is read from config.js, which is
// listed in .gitignore so it never reaches GitHub.
// Setup: copy config.example.js to config.js and paste your OpenWeather key in it.
// (New keys can take up to ~2 hours to activate.)
// If config.js is missing, the app still works using a keyless backup source.
const API_KEY = (window.APP_CONFIG && window.APP_CONFIG.OPENWEATHER_API_KEY) || "";
const API_URL = "https://api.openweathermap.org/data/2.5/weather";

// ====== ELEMENTS ======
const form = document.getElementById("search-form");
const cityInput = document.getElementById("city-input");
const loader = document.getElementById("loader");
const errorBox = document.getElementById("error");
const noteEl = document.getElementById("source-note");
const weatherCard = document.getElementById("weather");
const cityName = document.getElementById("city-name");
const icon = document.getElementById("weather-icon");
const tempEl = document.getElementById("temp");
const tempUnitEl = document.getElementById("temp-unit");
const descEl = document.getElementById("description");
const feelsEl = document.getElementById("feels-like");
const humidityEl = document.getElementById("humidity");
const windEl = document.getElementById("wind");
const btnC = document.getElementById("unit-c");
const btnF = document.getElementById("unit-f");

// ====== STATE ======
// Data is fetched in metric units; Fahrenheit is converted on the client
// so toggling the unit never needs another network request.
let currentData = null;
let unit = "C";

const cToF = (c) => (c * 9) / 5 + 32;

// ====== UI HELPERS ======
function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  weatherCard.classList.add("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function setLoading(isLoading) {
  loader.classList.toggle("hidden", !isLoading);
}

function themeFor(main) {
  const key = main.toLowerCase();
  if (key === "clear") return "theme-clear";
  if (key === "clouds") return "theme-clouds";
  if (key === "rain" || key === "drizzle") return "theme-rain";
  if (key === "thunderstorm") return "theme-storm";
  if (key === "snow") return "theme-snow";
  return "theme-mist"; // mist, haze, fog, smoke, dust, etc.
}

function render() {
  if (!currentData) return;
  const { name, sys, main, weather, wind } = currentData;
  const w = weather[0];

  cityName.textContent = sys && sys.country ? `${name}, ${sys.country}` : name;
  icon.src = `https://openweathermap.org/img/wn/${w.icon}@2x.png`;
  icon.alt = w.description;
  descEl.textContent = w.description;
  humidityEl.textContent = `${main.humidity}%`;

  const t = unit === "C" ? main.temp : cToF(main.temp);
  const feels = unit === "C" ? main.feels_like : cToF(main.feels_like);
  tempEl.textContent = Math.round(t);
  tempUnitEl.textContent = `°${unit}`;
  feelsEl.textContent = `${Math.round(feels)}°${unit}`;

  // API returns m/s in metric units; show km/h for readability in °C and mph in °F.
  windEl.textContent =
    unit === "C"
      ? `${(wind.speed * 3.6).toFixed(1)} km/h`
      : `${(wind.speed * 2.23694).toFixed(1)} mph`;

  document.body.className = themeFor(w.main);
  weatherCard.classList.remove("hidden");
}

// ====== API ======
class AuthError extends Error {}

const NOT_FOUND_MSG = "City not found. Please check the spelling and try again.";

// Primary source: OpenWeather (requires API key)
async function fetchOpenWeather(city) {
  const url = `${API_URL}?q=${encodeURIComponent(city)}&units=metric&appid=${API_KEY}`;
  const res = await fetch(url);

  if (res.status === 404) throw new Error(NOT_FOUND_MSG);
  if (res.status === 401) throw new AuthError();
  if (res.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
  if (!res.ok) throw new Error(`Something went wrong (error ${res.status}). Please try again.`);
  return res.json();
}

// WMO weather code -> OpenWeather-style { main, description, icon base }
function wmoToCondition(code) {
  if (code === 0) return { main: "Clear", description: "clear sky", icon: "01" };
  if (code === 1) return { main: "Clear", description: "mainly clear", icon: "02" };
  if (code === 2) return { main: "Clouds", description: "partly cloudy", icon: "03" };
  if (code === 3) return { main: "Clouds", description: "overcast", icon: "04" };
  if (code === 45 || code === 48) return { main: "Mist", description: "fog", icon: "50" };
  if (code >= 51 && code <= 57) return { main: "Drizzle", description: "drizzle", icon: "09" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { main: "Rain", description: "rain", icon: code >= 80 ? "09" : "10" };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { main: "Snow", description: "snow", icon: "13" };
  }
  if (code >= 95) return { main: "Thunderstorm", description: "thunderstorm", icon: "11" };
  return { main: "Clouds", description: "cloudy", icon: "03" };
}

// Backup source: Open-Meteo (no API key needed). Output is shaped like OpenWeather's
// response so the same render() code works for both sources.
async function fetchOpenMeteo(city) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`
  );
  if (!geoRes.ok) throw new Error(`Something went wrong (error ${geoRes.status}). Please try again.`);
  const geo = await geoRes.json();
  if (!geo.results || geo.results.length === 0) throw new Error(NOT_FOUND_MSG);
  const place = geo.results[0];

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
    wind_speed_unit: "ms",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Something went wrong (error ${res.status}). Please try again.`);
  const data = await res.json();
  const c = data.current;
  const cond = wmoToCondition(c.weather_code);

  return {
    name: place.name,
    sys: { country: place.country_code },
    main: { temp: c.temperature_2m, feels_like: c.apparent_temperature, humidity: c.relative_humidity_2m },
    weather: [{
      main: cond.main,
      description: cond.description,
      icon: `${cond.icon}${c.is_day ? "d" : "n"}`,
    }],
    wind: { speed: c.wind_speed_10m },
  };
}

async function fetchWeather(city) {
  clearError();
  setLoading(true);
  weatherCard.classList.add("hidden");
  noteEl.classList.add("hidden");

  try {
    const keyMissing = !API_KEY || API_KEY === "YOUR_API_KEY_HERE";
    try {
      if (keyMissing) throw new AuthError();
      currentData = await fetchOpenWeather(city);
    } catch (err) {
      // Key missing / not active yet: use the keyless backup so the app still works
      if (!(err instanceof AuthError)) throw err;
      currentData = await fetchOpenMeteo(city);
      noteEl.textContent = keyMissing
        ? "Showing backup data (Open-Meteo). Add your OpenWeather API key in config.js."
        : "OpenWeather key not active yet - showing backup data (Open-Meteo).";
      noteEl.classList.remove("hidden");
    }
    render();
  } catch (err) {
    // fetch() itself rejects with a TypeError on network failures
    if (err instanceof TypeError) {
      showError("Network error. Check your internet connection and try again.");
    } else {
      showError(err.message);
    }
  } finally {
    setLoading(false);
  }
}

// ====== EVENTS ======
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const city = cityInput.value.trim();
  if (!city) {
    showError("Please enter a city name.");
    return;
  }
  fetchWeather(city);
});

function setUnit(next) {
  unit = next;
  btnC.classList.toggle("active", next === "C");
  btnF.classList.toggle("active", next === "F");
  btnC.setAttribute("aria-pressed", String(next === "C"));
  btnF.setAttribute("aria-pressed", String(next === "F"));
  render();
}

btnC.addEventListener("click", () => setUnit("C"));
btnF.addEventListener("click", () => setUnit("F"));
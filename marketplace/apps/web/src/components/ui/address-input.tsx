"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "./form";

/* eslint-disable @typescript-eslint/no-explicit-any -- Google Maps JS has no bundled types. */
type Places = any;

let placesLib: Promise<Places> | null = null;
/** Google calls this when the browser key is rejected (wrong website, API not allowed, billing…). */
let authFailed = false;

/** Loads Google Maps JS once per page and resolves to the Places library (Places API "New"). */
export function loadPlaces(key: string): Promise<Places> {
  if (!placesLib) {
    placesLib = new Promise<void>((resolve, reject) => {
      const w = window as any;
      w.gm_authFailure = () => {
        authFailed = true;
        console.error("[maps] Google rejected GOOGLE_MAPS_BROWSER_KEY for this page (" + location.origin + "). Check the key's website list and that Maps JavaScript API + Places API (New) are allowed.");
        window.dispatchEvent(new Event("cm-maps-auth-failure"));
      };
      if (w.google?.maps?.importLibrary) return resolve();
      w.__cmMapsReady = () => resolve();
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__cmMapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error("Google Maps failed to load"));
      document.head.appendChild(s);
    }).then(() => (window as any).google.maps.importLibrary("places"));
    placesLib.catch(() => (placesLib = null));
  }
  return placesLib;
}

/**
 * Street-address field with Google Places suggestions. Picking a suggestion
 * fills the full postal address and a hidden `${name}PlaceId`, which the
 * server geocodes directly. Without a browser key (or if Google fails to
 * load) it's a plain text field, and typed addresses are still accepted.
 */
export function AddressInput({ name, defaultValue, placeholder, required, browserKey }: { name: string; defaultValue?: string; placeholder?: string; required?: boolean; browserKey?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [placeId, setPlaceId] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<{ text: string; prediction: any }[]>([]);
  const places = useRef<Places | null>(null);
  const session = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  // Clear along with the rest of the form when it resets after saving.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const reset = () => (setValue(defaultValue ?? ""), setPlaceId(""));
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!browserKey) return;
    const off = () => setUnavailable(true);
    window.addEventListener("cm-maps-auth-failure", off);
    if (authFailed) off();
    loadPlaces(browserKey).then((p) => (places.current = p)).catch((e) => (console.error("[maps]", e), off()));
    return () => window.removeEventListener("cm-maps-auth-failure", off);
  }, [browserKey]);

  function lookup(text: string) {
    if (timer.current) clearTimeout(timer.current);
    if (!places.current || text.trim().length < 4) return setSuggestions([]);
    timer.current = setTimeout(async () => {
      const p = places.current;
      session.current ??= new p.AutocompleteSessionToken();
      const mine = ++seq.current;
      try {
        const { suggestions: found } = await p.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: text, sessionToken: session.current, includedRegionCodes: ["us"] });
        if (mine !== seq.current) return;
        setSuggestions(found.filter((s: any) => s.placePrediction).slice(0, 5).map((s: any) => ({ text: s.placePrediction.text.toString(), prediction: s.placePrediction })));
        setActive(-1);
        setOpen(true);
      } catch (e) {
        console.error("[maps] Address suggestions failed:", e);
        setUnavailable(true);
        setSuggestions([]);
      }
    }, 250);
  }

  async function pick(i: number) {
    const s = suggestions[i];
    if (!s) return;
    setOpen(false);
    setSuggestions([]);
    setValue(s.text.replace(/, USA$/, ""));
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress"] });
      setValue(String(place.formattedAddress ?? s.text).replace(/, USA$/, ""));
      setPlaceId(place.id);
    } catch {
      setPlaceId(s.prediction.placeId ?? "");
    }
    session.current = null; // a session ends with the pick
  }

  return (
    <div className="relative">
      <Input
        ref={input}
        name={name}
        value={value}
        placeholder={placeholder}
        required={required}
        autoComplete="street-address"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          setPlaceId("");
          lookup(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !suggestions.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, suggestions.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && active >= 0) (e.preventDefault(), pick(active));
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      <input type="hidden" name={`${name}PlaceId`} value={placeId} />
      {open && suggestions.length ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {suggestions.map((s, i) => (
            <li
              key={s.text}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(i))}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${i === active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <MapPin className="size-4 shrink-0 text-slate-400" />
              {s.text.replace(/, USA$/, "")}
            </li>
          ))}
          <li className="px-3 pb-1 pt-1.5 text-right text-[10px] text-slate-400">powered by Google</li>
        </ul>
      ) : null}
      {unavailable ? <p className="mt-1 text-xs text-slate-500">Address suggestions aren&apos;t available right now — type the full street address, city, state and ZIP.</p> : null}
    </div>
  );
}

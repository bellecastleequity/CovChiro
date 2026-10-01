"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui/form";

export interface SchoolGroup {
  professionCode: string;
  label: string;
  schools: { name: string; city: string | null; state: string | null }[];
}

const OTHER = "__other";

/** Dropdown of schools from the database, with "Not listed" for anything else. Posts `school`. */
export function SchoolPicker({ groups, defaultValue }: { groups: SchoolGroup[]; defaultValue?: string | null }) {
  const names = new Set(groups.flatMap((g) => g.schools.map((s) => s.name)));
  const initial = defaultValue ? (names.has(defaultValue) ? defaultValue : OTHER) : "";
  const [choice, setChoice] = useState(initial);
  const [other, setOther] = useState(initial === OTHER ? (defaultValue ?? "") : "");
  if (!groups.length) return <Input id="school" name="school" defaultValue={defaultValue ?? ""} required />;
  const single = groups.length === 1;
  return (
    <div className="space-y-2">
      <Select id="school" value={choice} onChange={(e) => setChoice(e.target.value)} required>
        <option value="" disabled>Choose your school…</option>
        {single
          ? groups[0].schools.map((s) => <option key={s.name} value={s.name}>{s.name}{s.state ? ` (${s.state})` : ""}</option>)
          : groups.map((g) => (
              <optgroup key={g.professionCode} label={g.label}>
                {g.schools.map((s) => <option key={s.name} value={s.name}>{s.name}{s.state ? ` (${s.state})` : ""}</option>)}
              </optgroup>
            ))}
        <option value={OTHER}>My school isn&apos;t listed</option>
      </Select>
      {choice === OTHER ? <Input aria-label="School name" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Type your school's name" required /> : null}
      <input type="hidden" name="school" value={choice === OTHER ? other : choice} />
    </div>
  );
}

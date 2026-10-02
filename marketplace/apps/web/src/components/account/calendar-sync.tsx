import { CalendarPlus } from "lucide-react";
import { calendar } from "@cm/services";
import { resetCalendarAction } from "@/app/account-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { CopyText } from "./copy-text";

/** "Sync to your calendar": a private feed link for Google / Apple / Outlook. */
export async function CalendarSync({ userId, who }: { userId: string; who: "provider" | "clinic" }) {
  const l = await calendar.calendarLinks(userId);
  return (
    <details className="group mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-800">
        <CalendarPlus className="size-4 text-accent-600" /> Sync {who === "provider" ? "your shifts" : "your coverage"} to your calendar
        <span className="ml-auto text-xs font-normal text-slate-500 group-open:hidden">Google, Apple, Outlook</span>
      </summary>
      <div className="mt-3 space-y-3 text-slate-700">
        <p>Booked shifts appear in your calendar automatically and update when something changes{who === "clinic" ? ", with your provider's name once a shift is filled" : ""}. Calendars refresh every few hours.</p>
        <div className="flex flex-wrap gap-2">
          <a href={l.google} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>Add to Google Calendar</a>
          <a href={l.webcal} className={buttonClass("outline", "sm")}>Add to Apple / Outlook</a>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">Or paste this link where your calendar says &quot;Subscribe&quot; / &quot;From URL&quot;:</div>
          <CopyText text={l.https} />
        </div>
        <p className="text-xs text-slate-500">Keep this link private: anyone with it can see your schedule. Shared it by mistake?</p>
        <ActionForm action={resetCalendarAction} confirm="Make a new link? Calendars using the current link stop updating.">
          <SubmitButton size="sm" variant="ghost">Make a new link</SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}

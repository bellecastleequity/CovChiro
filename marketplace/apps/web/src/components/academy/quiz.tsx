"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { QuizQuestion } from "@/lib/academy/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { markDone } from "./progress";
import { lessonPassedAction } from "@/app/academy-actions";

/** Quick check at the end of a lesson. All correct marks the lesson complete. */
export function Quiz({ questions, userId, course, slug }: { questions: QuizQuestion[]; userId: string; course: string; slug: string }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => questions.map(() => null));
  const [checked, setChecked] = useState(false);
  const allAnswered = picked.every((p) => p !== null);
  const score = picked.filter((p, i) => p === questions[i]!.answer).length;
  const passed = checked && score === questions.length;

  return (
    <div className="space-y-5">
      {questions.map((q, i) => (
        <fieldset key={i} className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            {i + 1}. {q.q}
          </legend>
          <div className="mt-2 space-y-1.5">
            {q.options.map((o, j) => {
              const isPicked = picked[i] === j;
              const right = checked && j === q.answer;
              const wrong = checked && isPicked && j !== q.answer;
              return (
                <label key={j} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", right ? "border-emerald-300 bg-emerald-50" : wrong ? "border-red-300 bg-red-50" : isPicked ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                  <input
                    type="radio"
                    name={`q${i}`}
                    className="mt-0.5 accent-brand-600"
                    checked={isPicked}
                    onChange={() => {
                      setChecked(false);
                      setPicked((p) => p.map((v, k) => (k === i ? j : v)));
                    }}
                  />
                  <span className="flex-1">{o}</span>
                  {right ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : wrong ? <XCircle className="size-4 shrink-0 text-red-600" /> : null}
                </label>
              );
            })}
          </div>
          {checked && picked[i] !== null ? <p className={cn("mt-2 text-sm", picked[i] === q.answer ? "text-emerald-800" : "text-red-800")}>{q.why}</p> : null}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!allAnswered}
          onClick={() => {
            setChecked(true);
            if (picked.every((p, i) => p === questions[i]!.answer)) {
              markDone(userId, course, slug);
              void lessonPassedAction(slug);
            }
          }}
        >
          Check answers
        </Button>
        {checked ? (
          <span role="status" className={cn("text-sm font-medium", passed ? "text-emerald-700" : "text-slate-700")}>
            {passed ? "All correct — lesson complete." : `${score} of ${questions.length} correct. Change your answers and check again.`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, MessageCircle, Phone, Share2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/**
 * Share a referral link from the person's own device: the phone's share sheet (Messages,
 * WhatsApp, Gmail, Facebook…) when available, plus direct buttons. Nothing is sent by us.
 */
export function SharePanel({ link, message, subject }: { link: string; message: string; subject: string }) {
  const [copied, setCopied] = useState(false);
  const text = `${message} ${link}`;
  const enc = encodeURIComponent;
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  const targets: { label: string; href: string; icon?: React.ReactNode }[] = [
    { label: "Text", href: `sms:?&body=${enc(text)}`, icon: <Phone className="size-4" /> },
    { label: "WhatsApp", href: `https://wa.me/?text=${enc(text)}`, icon: <MessageCircle className="size-4" /> },
    { label: "Email", href: `mailto:?subject=${enc(subject)}&body=${enc(`${message}\n\n${link}`)}`, icon: <Mail className="size-4" /> },
    { label: "Gmail", href: `https://mail.google.com/mail/?view=cm&fs=1&su=${enc(subject)}&body=${enc(`${message}\n\n${link}`)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}` },
    { label: "X", href: `https://twitter.com/intent/tweet?text=${enc(message)}&url=${enc(link)}` },
  ];
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm" />
        <button
          type="button"
          className={buttonClass("outline")}
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {canShare ? (
        <button type="button" className={buttonClass("primary", "lg", "w-full")} onClick={() => navigator.share({ title: subject, text: message, url: link }).catch(() => undefined)}>
          <Share2 className="size-4" /> Share your link
        </button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => (
          <a key={t.label} href={t.href} target={t.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
            {t.icon}
            {t.label}
          </a>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { PHONE_PRIVACY_NOTE } from "@cm/core";
import { phones, type Actor } from "@cm/services";
import { Alert } from "@/components/ui/misc";

/** Phone numbers on file (core phones.ts): nothing when they're there. Providers need one, clinics two. */
export async function PhoneBanner({ actor, className = "mb-6" }: { actor: Actor; className?: string }) {
  if ((await phones.phoneStatus(actor)).ok) return null;
  if (actor.providerId) {
    return (
      <Alert tone="warning" className={className} title="Add your phone number to take shifts">
        You can&apos;t apply for or accept shifts until a phone number is on file. {PHONE_PRIVACY_NOTE} <Link href="/provider/profile" className="font-medium underline">Add it on your Profile →</Link>
      </Alert>
    );
  }
  return (
    <Alert tone="warning" className={className} title="Add two phone numbers to post shifts">
      Your clinic needs two different phone numbers on file before you can post shifts or choose providers. {PHONE_PRIVACY_NOTE} <Link href="/clinic/settings#phones" className="font-medium underline">Add them in Settings →</Link>
    </Alert>
  );
}

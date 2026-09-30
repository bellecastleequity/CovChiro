import { notFound } from "next/navigation";
import { Ban, Heart } from "lucide-react";
import { DomainError } from "@cm/core";
import { clinicRelationshipWith, providerPublicProfile } from "@cm/services";
import { ProviderProfileView } from "@/components/provider-profile";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/form";
import { requireActor } from "@/lib/session";
import { blockAction, favoriteAction, unblockAction } from "../../actions";

export default async function ClinicProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  const id = (await params).id;
  const p = await providerPublicProfile(actor, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const rel = await clinicRelationshipWith(actor, id);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-end gap-2">
        {rel.workedTogether && !rel.blocked ? (
          <ActionForm action={favoriteAction}>
            <input type="hidden" name="providerId" value={id} />
            <input type="hidden" name="on" value={rel.favorite ? "0" : "1"} />
            <SubmitButton size="sm" variant="outline"><Heart className={`size-4 ${rel.favorite ? "fill-red-500 text-red-500" : ""}`} />{rel.favorite ? "Favorited" : "Add to favorites"}</SubmitButton>
          </ActionForm>
        ) : null}
        {rel.blocked ? (
          <ActionForm action={unblockAction} confirm="Unblock this provider? They can be offered your shifts again.">
            <input type="hidden" name="providerId" value={id} />
            <SubmitButton size="sm" variant="outline"><Ban className="size-4" />Blocked — unblock</SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={blockAction} confirm="Block this provider from your future bookings? Only you will know." className="flex gap-2">
            <input type="hidden" name="providerId" value={id} />
            <Input name="reason" placeholder="Private note (optional)" className="h-9 w-52" />
            <SubmitButton size="sm" variant="outline"><Ban className="size-4" />Block from future bookings</SubmitButton>
          </ActionForm>
        )}
      </div>
      <ProviderProfileView p={p} />
    </>
  );
}

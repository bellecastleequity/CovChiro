import { resendVerificationAction } from "@/app/(auth)/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

/** "Resend confirmation email" button; shows "Sent to …" or the reason it couldn't send. */
export function ResendVerification({ label = "Resend confirmation email", className }: { label?: string; className?: string }) {
  return (
    <ActionForm action={resendVerificationAction} className={className}>
      <SubmitButton size="sm" variant="outline" pendingText="Sending…">{label}</SubmitButton>
    </ActionForm>
  );
}

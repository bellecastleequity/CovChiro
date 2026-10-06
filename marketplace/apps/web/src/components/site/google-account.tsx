import { google } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { disconnectGoogleAction } from "@/app/account-actions";
import { GoogleButton } from "./google-button";

/**
 * Profile / Settings: connect any Google account to this login (whatever its email), or
 * disconnect it. `notice` = the ?google= code the Google round trip came back with.
 */
export function GoogleAccountCard({ connected, hasPassword, back, notice }: { connected: boolean; hasPassword: boolean; back: string; notice?: string }) {
  if (!google.googleEnabled() && !connected) return null;
  const problem = notice && notice !== "connected" ? google.GOOGLE_PROBLEMS[notice as keyof typeof google.GOOGLE_PROBLEMS] : null;
  return (
    <Card id="google" className="scroll-mt-20">
      <CardHeader
        title="Google sign-in"
        description={connected ? "Connected. You can sign in with Continue with Google, using the Google account you connected." : "Connect a Google account to sign in with one click. It can be any Google account, even one with a different email from this login."}
      />
      <CardBody className="space-y-3">
        {notice === "connected" ? <Alert tone="success">Google is connected. Next time, use Continue with Google on the sign-in page.</Alert> : null}
        {problem ? <Alert tone={notice === "cancelled" ? "info" : "error"}>{problem}</Alert> : null}
        {connected ? (
          hasPassword ? (
            <ActionForm action={disconnectGoogleAction} successMessage>
              <SubmitButton variant="outline" size="sm">Disconnect Google</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-600">To disconnect Google, set a password first (below), so you can still sign in.</p>
          )
        ) : google.googleEnabled() ? (
          <div className="max-w-xs">
            <GoogleButton params={{ intent: "connect", next: back }} label="Connect Google account" />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

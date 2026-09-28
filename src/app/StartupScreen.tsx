import { Logomark } from "@/design-system/Logomark";

interface StartupScreenProps {
  /** Present when startup failed. */
  message?: string;
  logDirectory?: string | null;
}

/** Shown while the workspace opens, or instead of it if startup failed. */
export function StartupScreen({ message, logDirectory }: StartupScreenProps) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 bg-bg px-8 text-center text-text">
      <Logomark height={56} />
      <p className="m-0 font-display text-[1.875rem] font-semibold text-text-strong">Abiding Word</p>
      {message ? (
        <div role="alert" className="flex max-w-[36rem] flex-col gap-3">
          <p className="m-0 text-[1.0625rem] text-danger">{message}</p>
          {logDirectory && (
            <p className="m-0 text-[0.9375rem] text-text-muted">
              Log files: <code className="break-all">{logDirectory}</code>
            </p>
          )}
        </div>
      ) : (
        <p role="status" className="m-0 text-text-muted">
          Opening your workspace…
        </p>
      )}
    </main>
  );
}

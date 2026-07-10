import type { ReactNode } from "react";

/**
 * Shared layout for the footer/static pages (BIV-803): consistent width,
 * heading hierarchy and typography, semantic tokens only.
 */
export function StaticPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {intro && (
        <p className="mt-4 text-lg text-muted-foreground">{intro}</p>
      )}
      <div className="mt-8 space-y-8">{children}</div>
    </section>
  );
}

export function StaticSection({
  heading,
  children,
  id,
}: {
  heading?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="space-y-3 scroll-mt-20" id={id}>
      {heading && (
        <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
      )}
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}

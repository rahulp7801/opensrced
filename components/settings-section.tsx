/** A titled row on the settings-style pages (/crucible, /account): the
 *  heading and why on the left, the controls on the right. */
export function SettingsSection({
  id,
  title,
  description,
  note,
  children,
}: {
  id: string;
  title: string;
  description: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-7 py-10 md:grid-cols-[260px_minmax(0,1fr)] md:gap-14" aria-labelledby={id}>

      <div>
        <h2 id={id} className="display text-[24px] leading-[1.05] text-paper">{title}</h2>
        <p className="mt-3 text-[16px] leading-[1.6] text-paper-muted">{description}</p>
        {note && <p className="mt-4 text-[14px] leading-[1.55] text-paper-muted">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

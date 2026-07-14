type InfoCard = {
  title: string;
  body: string;
};

export function InfoGrid({ cards }: { cards: InfoCard[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <article key={card.title} className="rounded-[24px] bg-card p-5 shadow-ambient ring-1 ring-slate-200/60">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted">{card.title}</p>
          <p className="mt-3 text-sm leading-6 text-text">{card.body}</p>
        </article>
      ))}
    </div>
  );
}

import Link from "next/link";

type TabKey = "disliked" | "swipe" | "liked" | "tracking";

const TABS: {
  key: TabKey;
  href: string;
  label: string;
  icon: React.ReactNode;
  activeColor: string;
}[] = [
  {
    key: "disliked",
    href: "/disliked",
    label: "Disliked",
    activeColor: "text-dislike",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    ),
  },
  {
    key: "swipe",
    href: "/",
    label: "Swipe",
    activeColor: "text-accent",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="4" width="12" height="14" rx="2" />
        <rect x="3" y="7" width="12" height="14" rx="2" opacity="0.5" />
      </svg>
    ),
  },
  {
    key: "liked",
    href: "/liked",
    label: "Liked",
    activeColor: "text-like",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
  },
  {
    key: "tracking",
    href: "/tracking",
    label: "Tracking",
    activeColor: "text-accent",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
];

export function BottomNav({ active }: { active: TabKey }) {
  return (
    <nav className="sticky bottom-0 z-30 flex border-t border-line bg-bg/90 backdrop-blur">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] transition ${
              isActive ? `${t.activeColor} font-semibold` : "text-white/40"
            }`}
            aria-label={t.label}
          >
            {t.icon}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

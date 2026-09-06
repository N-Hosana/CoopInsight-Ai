import { useEffect, useState } from "react";

// Picks up any image dropped into src/app/assets/auth — no code change needed to add/remove photos.
const images = Object.values(
  import.meta.glob("../assets/auth/*.{jpg,jpeg,png,webp}", {
    eager: true,
    query: "?url",
    import: "default",
  })
) as string[];

interface AuthBackgroundProps {
  tagline: string;
  subtext: string;
}

export function AuthBackground({ tagline, subtext }: AuthBackgroundProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % images.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  if (images.length === 0) return null;

  return (
    <div className="relative hidden lg:block lg:w-[45%] overflow-hidden">
      {images.map((src, index) => (
        <img
          key={src}
          src={src}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            index === activeIndex ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {/* Brand-green cinematic wash — deliberately fixed (not theme-driven) so the panel reads
          consistently in both light and dark mode. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,40,24,0.15) 0%, rgba(13,40,24,0.45) 55%, rgba(13,40,24,0.92) 100%)",
        }}
      />

      <div className="absolute inset-x-0 bottom-0 p-10 text-white">
        <div className="h-1 w-12 rounded-full mb-4" style={{ backgroundColor: "#FAD201" }} />
        <h2 className="text-3xl font-bold leading-tight mb-3">{tagline}</h2>
        <p className="text-white/80 max-w-sm">{subtext}</p>

        {images.length > 1 && (
          <div className="flex gap-2 mt-6">
            {images.map((src, index) => (
              <button
                key={src}
                type="button"
                aria-label={`Show background photo ${index + 1}`}
                onClick={() => setActiveIndex(index)}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: index === activeIndex ? "1.5rem" : "0.5rem",
                  backgroundColor: index === activeIndex ? "#FAD201" : "rgba(255,255,255,0.4)",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

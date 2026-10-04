import "./_group.css";

/**
 * A direct, unedited capture of MainOffice running in the mobile app.
 * It keeps the comparison anchored to the real screen rather than sample data.
 */
export function Current() {
  return (
    <main
      aria-label="Current Personal Secretary mobile home"
      style={{
        width: "100%",
        minHeight: "100dvh",
        display: "grid",
        placeItems: "start center",
        overflow: "hidden",
        background: "var(--secretary-background)",
      }}
    >
      <img
        src="/__mockup/images/current-main-office.jpg"
        alt="Screenshot of the existing Personal Secretary MainOffice mobile screen"
        style={{
          display: "block",
          width: "100%",
          height: "100dvh",
          objectFit: "contain",
          objectPosition: "top center",
        }}
      />
    </main>
  );
}
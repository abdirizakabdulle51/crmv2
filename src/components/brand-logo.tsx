type BrandLogoProps = {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
};

export function BrandLogo({
  className = "",
  iconClassName = "h-9 w-9",
  textClassName = "text-lg",
}: BrandLogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img
        src="/htgclouds-icon.svg"
        alt=""
        aria-hidden="true"
        className={`${iconClassName} shrink-0`}
      />
      <span className={`font-bold tracking-tight ${textClassName}`}>
        HTGCLOUDS
      </span>
    </div>
  );
}

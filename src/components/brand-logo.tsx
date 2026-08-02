type BrandLogoProps = {
  className?: string;
  iconClassName?: string;
};

export function BrandLogo({
  className = "",
  iconClassName = "h-9 w-auto",
}: BrandLogoProps) {
  return (
    <div className={`flex items-center ${className}`}>
      <img
        src="/Logo.svg"
        alt="HTGCLOUDS"
        className={`${iconClassName} shrink-0 object-contain`}
      />
    </div>
  );
}

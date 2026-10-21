export default function BrandLogo({ variant = 'mark', className = '' }) {
  const description = variant === 'full' ? 'SwiftSpace room planning logo' : 'SwiftSpace logo';
  return (
    <span className={`brand-logo brand-logo-${variant} ${className}`.trim()} role="img" aria-label={description}>
      <img src="/brand/swiftspace-logo-transparent.png" alt="" />
    </span>
  );
}

interface BuyMeACoffeeProps {
  username?: string;
}

function BuyMeACoffee({
  username = 'tr1ck'
}: BuyMeACoffeeProps) {

  const handleClick = () => {
    window.open(`https://www.buymeacoffee.com/${username}`, '_blank');
  };

  return (
    <button
      className="flex min-h-11 w-full items-center justify-center rounded-xl px-3 py-2 shadow-md transition-transform hover:-translate-y-px"
      style={{ background: 'var(--bmc-bg)' }}
      onClick={handleClick}
    >
      <img src="/images/bmc-brand-logo.png" alt="Buy Me a Coffee" className="h-auto max-h-[22px] w-full max-w-[132px] object-contain" />
    </button>
  );
}

export default BuyMeACoffee;
